import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Account,
  AccountValuation,
  ActivityDetails,
  AddonContext,
  Asset,
  Holding,
  Quote,
} from '@wealthfolio/addon-sdk';
import { useEffect } from 'react';
import { day, today } from '../lib/dates';
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
  /** Close prices ascending by date, for valuing the holding at 1 January. */
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
  if (!series) return undefined;
  let found: AccountValuation | undefined;
  for (const p of series.points) {
    if (day(p.valuationDate) > date) break;
    found = p;
  }
  return found;
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
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    ctx.api.events.portfolio
      .onUpdateComplete(() => queryClient.invalidateQueries({ queryKey: ['skatt', 'data'] }))
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
      // Progress is one tick per network round trip below - not exact (the base
      // currency, and so the real exchange-rate count, is not known yet), but it
      // moves in step with the slow part: one call per account and per symbol.
      const totalTicks =
        tracked.length + depaAccountIds.size + depaAssetIds.size + exchangeRates.length;
      let doneTicks = 0;
      const tick = (label: string) => {
        doneTicks += 1;
        report({ fraction: 0.05 + 0.95 * (totalTicks > 0 ? doneTicks / totalTicks : 1), label });
      };

      const series: Record<string, Series> = {};
      await Promise.all(
        tracked.map(async (account) => {
          // One account without valuations must not blank the whole page - the
          // quarters simply come out unknown, which the year already reports.
          const points = await ctx.api.portfolio
            .getHistoricalValuations(account.id, start, end)
            .catch((error: unknown) => {
              ctx.api.logger.error(`No valuations for ${account.name}: ${String(error)}`);
              return [] as AccountValuation[];
            });
          series[account.id] = {
            points: [...points].sort((a, b) => day(a.valuationDate).localeCompare(day(b.valuationDate))),
            baseCurrency: points[0]?.baseCurrency ?? 'SEK',
          };
          tick(`Reading valuations for ${account.name}…`);
        }),
      );

      const base = Object.values(series)[0]?.baseCurrency ?? 'SEK';

      // Wealthfolio's own instrument-type taxonomy is only available for
      // currently-held positions, but that covers the common case; a symbol
      // sold out entirely falls back to the market data provider below.
      const holdingsBySymbol = new Map<string, Holding>();
      await Promise.all(
        [...depaAccountIds].map(async (accountId) => {
          const holdings = await ctx.api.portfolio.getHoldings(accountId).catch(() => [] as Holding[]);
          for (const h of holdings) {
            if (h.instrument?.symbol && !holdingsBySymbol.has(h.instrument.symbol)) {
              holdingsBySymbol.set(h.instrument.symbol, h);
            }
          }
          tick('Reading fund/ETF classifications…');
        }),
      );

      const assets: Record<string, AssetInfo> = {};
      await Promise.all(
        [...depaAssetIds].map(async ([symbol, assetId]) => {
          const holding = holdingsBySymbol.get(symbol);
          const category = holding?.instrument?.classifications?.assetType;
          // The fallback only fires for a symbol Wealthfolio never classified -
          // typically one fully sold before now, absent from current holdings.
          const profile: Asset | null = category
            ? null
            : await ctx.api.assets.getProfile(assetId).catch(() => null);
          const history = await ctx.api.quotes.getHistory(assetId).catch(() => [] as Quote[]);

          const rawCurrency = holding?.instrument?.currency ?? profile?.quoteCcy ?? base;
          // GBp/GBX quotes are pence, a hundredth of the GBP the FX history is
          // kept in - the same quirk rateOn corrects for below.
          const pence = rawCurrency === 'GBp' || rawCurrency === 'GBX';

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
          const categoryKnown = !!category && category.key !== 'OTHER_UNKNOWN';

          assets[symbol] = {
            currency: pence ? 'GBP' : rawCurrency,
            isFund: categoryKnown ? FUND_INSTRUMENT_KEYS.has(category!.key) : providerMatch || nameMatch,
            typeKnown: categoryKnown || !!profile?.instrumentType || nameMatch,
            typeLabel: categoryKnown
              ? category!.name
              : providerMatch
                ? profile!.instrumentType!
                : nameMatch
                  ? 'Fund/ETF, by name'
                  : (profile?.instrumentType ?? undefined),
            quotes: history
              .filter((q) => q.close > 0)
              .map((q) => ({ date: day(q.timestamp), close: pence ? q.close / 100 : q.close }))
              .sort((a, b) => a.date.localeCompare(b.date)),
          };
          tick(`Pricing ${symbol}…`);
        }),
      );

      // An exchange rate's id is the asset its quotes are stored under, so the
      // quote history of that asset is the daily rate series. That is what a
      // 2019 trade has to be converted with - not today's rate.
      const rates: Record<string, RatePoint[]> = {};
      await Promise.all(
        exchangeRates
          .filter((r) => r.toCurrency === base || r.fromCurrency === base)
          .map(async (r) => {
            const foreign = r.toCurrency === base ? r.fromCurrency : r.toCurrency;
            const invert = r.fromCurrency === base;
            const history = await ctx.api.quotes.getHistory(r.id).catch(() => [] as Quote[]);

            const points: RatePoint[] = history
              .filter((q) => q.close > 0)
              .map((q) => ({ date: day(q.timestamp), rate: invert ? 1 / q.close : q.close }))
              .sort((a, b) => a.date.localeCompare(b.date));

            // The current rate closes the gap between the last quote and today.
            if (r.rate > 0) points.push({ date: today(), rate: invert ? 1 / r.rate : r.rate });
            if (points.length > 0) rates[foreign] = points;
            tick(`Reading ${foreign} exchange rates…`);
          }),
      );

      const thisYear = new Date().getFullYear();
      const firstYear = Number(firstDate.slice(0, 4));
      const years: number[] = [];
      for (let y = thisYear; y >= firstYear; y--) years.push(y);

      // Some ticks above are skipped (an exchange rate not in the base
      // currency never fires one), so the count alone will not always reach
      // 1 - closing it out here keeps the bar from stalling short of done.
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
