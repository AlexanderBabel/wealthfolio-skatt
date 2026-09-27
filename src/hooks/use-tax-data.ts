import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Account,
  AccountValuation,
  ActivityDetails,
  AddonContext,
  Asset,
  ExchangeRate,
  Holding,
  Quote,
} from '@wealthfolio/addon-sdk';
import { useEffect } from 'react';
import { day, lastOnOrBefore, today } from '../lib/dates';
import { loadWrappers, type WrapperMap } from '../lib/storage';

/**
 * Wealthfolio's own "Instrument Type" taxonomy (source: AUTO) is a far more
 * reliable fund/ETF signal than the market data provider's raw instrumentType
 * - it correctly tags Xetra-listed UCITS ETFs that the provider field leaves
 * blank. ETN and ETC are debt/commodity notes, not investeringsfonder, so
 * they are deliberately left out even though Wealthfolio groups them nearby.
 */
export const FUND_INSTRUMENT_KEYS = new Set(['ETF', 'FUND', 'FUND_MUTUAL', 'FUND_FOF']);

/**
 * Neither Wealthfolio's own taxonomy nor the market data provider classifies
 * a position that has since been sold out entirely - both only look at
 * currently-open holdings. UCITS is a regulatory label almost never seen
 * outside a fund's own name, so it is a reliable last resort for exactly the
 * case that matters here: a fund held on 1 January and gone by the time the
 * addon runs.
 */
export const FUND_NAME_PATTERN = /UCITS|\bETF\b|\bFUND\b|\bFOND(EN)?\b/i;

/**
 * The wrapper map on its own, as a cheap storage read.
 *
 * `useTaxData` also loads it, but that query re-reads the whole portfolio and
 * takes seconds. Binding the Accounts dropdown to this one instead means a
 * selection shows up immediately rather than snapping back to the old value
 * until the portfolio finishes reloading behind it.
 */
export function useWrappers(ctx: AddonContext) {
  return useQuery<WrapperMap>({
    queryKey: ['skatt', 'wrappers'],
    queryFn: () => loadWrappers(ctx),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export interface Series {
  /** Valuations ascending by date. */
  points: AccountValuation[];
  baseCurrency: string;
}

interface RatePoint {
  date: string;
  /** Foreign currency to base currency on that date. */
  rate: number;
}

interface AssetInfo {
  currency: string;
  /** True when Wealthfolio's own instrument-type taxonomy - or, failing that, the
   *  market data provider's instrumentType - looks like a fund or ETF. */
  isFund: boolean;
  /** False when neither source classified the instrument at all - isFund is then a guess. */
  typeKnown: boolean;
  /** Human label for the detected type, e.g. "ETF" or "Mutual Fund". */
  typeLabel?: string;
  /** Close prices ascending by date, for valuing the holding at 1 January. Empty unless a fund. */
  quotes: { date: string; close: number }[];
}

export interface TaxData {
  accounts: Account[];
  wrappers: WrapperMap;
  activities: ActivityDetails[];
  series: Record<string, Series>;
  baseCurrency: string;
  /** Daily rate history to base currency, keyed by the foreign currency. */
  rates: Record<string, RatePoint[]>;
  /** One entry per symbol ever held in a depa account - for the fund schablonintakt. */
  assets: Record<string, AssetInfo>;
  years: number[];
}

/** Latest valuation on or before `date`, or undefined when the series starts later. */
export function valuationAt(series: Series | undefined, date: string): AccountValuation | undefined {
  return series && lastOnOrBefore(series.points, date, (p) => day(p.valuationDate));
}

/**
 * Daily rate history to `base`, keyed by the foreign currency. An exchange
 * rate's id is the asset its quotes are stored under, so the quote history of
 * that asset is the daily rate series - what a 2019 trade has to be converted
 * with, not today's rate.
 */
export function buildRates(
  fetched: { r: ExchangeRate; history: Quote[] }[],
  base: string,
): Record<string, RatePoint[]> {
  const rates: Record<string, RatePoint[]> = {};
  // Wealthfolio can hold a pair both ways round, EUR->SEK and SEK->EUR. The
  // direct one is kept: the inverse is stored rounded (0.08801) and turns
  // into 11.362 against a real 11.296. Inverted pairs go first so a direct
  // one overwrites them - this used to be whichever request finished last.
  const ordered = [...fetched].sort(
    (a, b) => Number(b.r.fromCurrency === base) - Number(a.r.fromCurrency === base),
  );
  for (const { r, history } of ordered) {
    if (r.toCurrency !== base && r.fromCurrency !== base) continue;
    const foreign = r.toCurrency === base ? r.fromCurrency : r.toCurrency;
    const invert = r.fromCurrency === base;
    const points: RatePoint[] = history
      .filter((q) => q.close > 0)
      .map((q) => ({ date: day(q.timestamp), rate: invert ? 1 / q.close : q.close }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // The current rate closes the gap between the last quote and today.
    if (r.rate > 0) points.push({ date: today(), rate: invert ? 1 / r.rate : r.rate });
    if (points.length > 0) rates[foreign] = points;
  }
  return rates;
}

export interface LoadProgress {
  /** 0..1 */
  fraction: number;
  label: string;
}

export function useTaxData(ctx: AddonContext, onProgress?: (progress: LoadProgress) => void) {
  const queryClient = useQueryClient();

  // Re-reading the portfolio is the slow part, so the result is kept for a
  // full day - but a full day is a ceiling, not the real signal. Wealthfolio
  // itself knows the moment a trade, edit or import changes the portfolio,
  // and tells every addon via this event, so the cache is invalidated then
  // rather than waited out.
  //
  // Marked stale only, not re-read on the spot: Wealthfolio runs a market data
  // sync on every start, and its event lands seconds after this page's first
  // load - re-reading then blanked the page and doubled the wait. A trade or
  // import happens on another page, so the re-read comes on returning here.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    ctx.api.events.portfolio
      .onUpdateComplete(() =>
        queryClient.invalidateQueries({ queryKey: ['skatt', 'data'], refetchType: 'none' }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((error: unknown) =>
        ctx.api.logger.error(`Could not listen for portfolio updates: ${String(error)}`),
      );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ctx, queryClient]);

  return useQuery<TaxData>({
    queryKey: ['skatt', 'data'],
    staleTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      // Classifying another account mid-read supersedes this run. React Query
      // will discard its result, but the awaits below keep resolving and would
      // otherwise carry on driving the progress bar - two runs reporting into
      // one bar is what makes it jump backwards. A superseded run goes quiet.
      const report = (progress: LoadProgress) => {
        if (!signal.aborted) onProgress?.(progress);
      };

      report({ fraction: 0.02, label: 'Reading accounts and activities…' });
      const [accounts, wrappers, activities, exchangeRates] = await Promise.all([
        ctx.api.accounts.getAll(),
        loadWrappers(ctx),
        ctx.api.activities.getAll(),
        ctx.api.exchangeRates.getAll().catch(() => []),
      ]);

      const tracked = accounts.filter((a) => (wrappers[a.id] ?? 'IGNORE') !== 'IGNORE');
      const firstDate = activities.reduce(
        (min, a) => (day(a.date) < min ? day(a.date) : min),
        today(),
      );
      const start = `${Number(firstDate.slice(0, 4)) - 1}-12-01`;
      const end = today();

      const depaAccountIds = new Set(
        accounts.filter((a) => (wrappers[a.id] ?? 'IGNORE') === 'DEPA').map((a) => a.id),
      );
      const depaAssetIds = new Map<string, string>();
      const depaAssetNames = new Map<string, string>();
      for (const a of activities) {
        if (!depaAccountIds.has(a.accountId)) continue;
        if (!depaAssetIds.has(a.assetSymbol)) depaAssetIds.set(a.assetSymbol, a.assetId);
        if (a.assetName && !depaAssetNames.has(a.assetSymbol)) {
          depaAssetNames.set(a.assetSymbol, a.assetName);
        }
      }
      // Progress is one tick per network round trip below. Every exchange rate
      // fires one, so the count is exact even before the base currency is known.
      const totalTicks =
        tracked.length + depaAccountIds.size + depaAssetIds.size + exchangeRates.length;
      let doneTicks = 0;
      const tick = (label: string) => {
        doneTicks += 1;
        report({ fraction: 0.05 + 0.95 * (totalTicks > 0 ? doneTicks / totalTicks : 1), label });
      };

      // Everything below is independent round trips, so it all goes out in one
      // wave: waiting for the valuations before asking for a single quote made
      // the load the sum of four phases instead of the slowest one.
      const seriesP = Promise.all(
        tracked.map(async (account) => {
          // One account without valuations must not blank the whole page - the
          // quarters simply come out unknown, which the year already reports.
          // Only an ISK's quarter starts are ever read, and a full daily history
          // runs to megabytes per account. The rest ask for today alone, which
          // still says what the base currency is when there is no ISK.
          const from = wrappers[account.id] === 'ISK' ? start : end;
          const points = await ctx.api.portfolio
            .getHistoricalValuations(account.id, from, end)
            .catch((error: unknown) => {
              ctx.api.logger.error(`No valuations for ${account.name}: ${String(error)}`);
              return [] as AccountValuation[];
            });
          tick(`Reading valuations for ${account.name}…`);
          return [
            account.id,
            {
              points: [...points].sort((a, b) => day(a.valuationDate).localeCompare(day(b.valuationDate))),
              baseCurrency: points[0]?.baseCurrency ?? 'SEK',
            },
          ] as const;
        }),
      );

      // Wealthfolio's own instrument-type taxonomy is only available for
      // currently-held positions, but that covers the common case; a symbol
      // sold out entirely falls back to the market data provider below.
      const holdingsP = Promise.all(
        [...depaAccountIds].map(async (accountId) => {
          const holdings = await ctx.api.portfolio.getHoldings(accountId).catch(() => [] as Holding[]);
          tick('Reading fund/ETF classifications…');
          return holdings;
        }),
      ).then((perAccount) => {
        const bySymbol = new Map<string, Holding>();
        for (const h of perAccount.flat()) {
          if (h.instrument?.symbol && !bySymbol.has(h.instrument.symbol)) bySymbol.set(h.instrument.symbol, h);
        }
        return bySymbol;
      });

      // Most of the load is price history, and it only prices funds at
      // 1 January - so a security's type is settled first and only a fund's
      // history is fetched. Under a burst of requests the server answers each
      // one slower, so the ones skipped here speed up everything else too.
      const assetsP = Promise.all(
        [...depaAssetIds].map(async ([symbol, assetId]) => {
          const holding = (await holdingsP).get(symbol);
          const category = holding?.instrument?.classifications?.assetType;
          const categoryKnown = !!category && category.key !== 'OTHER_UNKNOWN';
          // The fallback only fires for a symbol Wealthfolio never classified -
          // typically one fully sold before now, absent from current holdings.
          const profile: Asset | null = category
            ? null
            : await ctx.api.assets.getProfile(assetId).catch(() => null);

          // The security's own name is checked unconditionally, not just when
          // the two sources above are silent - a data provider that has never
          // heard of a Xetra-listed UCITS ETF often tags it "EQUITY" rather
          // than leaving the field blank, which would otherwise block this
          // check from ever running. "UCITS" and "ETF" are not names a stock
          // carries, so a hit here is trusted as much as an explicit type.
          // Wealthfolio's own classification is the one signal reliable enough
          // to also rule a fund OUT, since it is confirmed correct against a
          // real holding - unless it could not classify the asset at all.
          const nameMatch = FUND_NAME_PATTERN.test(depaAssetNames.get(symbol) ?? '');
          const providerMatch = /ETF|FUND/i.test(profile?.instrumentType ?? '');
          const isFund = categoryKnown ? FUND_INSTRUMENT_KEYS.has(category!.key) : providerMatch || nameMatch;

          const history = isFund
            ? await ctx.api.quotes.getHistory(assetId).catch(() => [] as Quote[])
            : [];
          tick(`Pricing ${symbol}…`);
          return {
            symbol,
            rawCurrency: holding?.instrument?.currency ?? profile?.quoteCcy,
            history,
            info: {
              isFund,
              typeKnown: categoryKnown || !!profile?.instrumentType || nameMatch,
              typeLabel: categoryKnown
                ? category!.name
                : providerMatch
                  ? profile!.instrumentType!
                  : nameMatch
                    ? 'Fund/ETF, by name'
                    : (profile?.instrumentType ?? undefined),
            },
          };
        }),
      );

      // Which exchange-rate pairs matter depends on the base currency, not
      // known until the valuations are in, so every pair is fetched now and
      // buildRates drops the rest.
      // ponytail: a pair not touching the base costs one wasted request; filter
      // up front if Wealthfolio ever keeps many of those.
      const ratesP = Promise.all(
        exchangeRates.map(async (r) => {
          const history = await ctx.api.quotes.getHistory(r.id).catch(() => [] as Quote[]);
          tick(`Reading ${r.fromCurrency}/${r.toCurrency} exchange rates…`);
          return { r, history };
        }),
      );

      const [seriesEntries, fetchedAssets, fetchedRates] = await Promise.all([seriesP, assetsP, ratesP]);

      const series: Record<string, Series> = Object.fromEntries(seriesEntries);
      const base = seriesEntries[0]?.[1].baseCurrency ?? 'SEK';

      const assets: Record<string, AssetInfo> = {};
      for (const { symbol, rawCurrency = base, history, info } of fetchedAssets) {
        // GBp/GBX quotes are pence, a hundredth of the GBP the FX history is
        // kept in - the same quirk rateOn corrects for.
        const pence = rawCurrency === 'GBp' || rawCurrency === 'GBX';
        assets[symbol] = {
          ...info,
          currency: pence ? 'GBP' : rawCurrency,
          quotes: history
            .filter((q) => q.close > 0)
            .map((q) => ({ date: day(q.timestamp), close: pence ? q.close / 100 : q.close }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        };
      }

      const rates = buildRates(fetchedRates, base);

      const thisYear = new Date().getFullYear();
      const firstYear = Number(firstDate.slice(0, 4));
      const years: number[] = [];
      for (let y = thisYear; y >= firstYear; y--) years.push(y);

      report({ fraction: 1, label: 'Done' });

      return {
        accounts,
        wrappers,
        activities,
        series,
        baseCurrency: base,
        rates,
        assets,
        years: years.length > 0 ? years : [thisYear],
      };
    },
  });
}
