import { useQuery } from '@tanstack/react-query';
import type {
  Account,
  AccountValuation,
  ActivityDetails,
  AddonContext,
  Quote,
} from '@wealthfolio/addon-sdk';
import { useMemo } from 'react';
import {
  computeTaxYear,
  type IskAccount,
  type SecurityEvent,
  type TaxYearResult,
  type Warning,
  type Wrapper,
} from '../lib/swedish-tax';

export const WRAPPERS_KEY = 'account-wrappers';

export type WrapperMap = Record<string, Wrapper>;

export async function loadWrappers(ctx: AddonContext): Promise<WrapperMap> {
  const raw = await ctx.api.storage.get(WRAPPERS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as WrapperMap;
  } catch {
    ctx.api.logger.error('Stored account classification is not valid JSON, ignoring it.');
    return {};
  }
}

export async function saveWrappers(ctx: AddonContext, wrappers: WrapperMap): Promise<void> {
  await ctx.api.storage.set(WRAPPERS_KEY, JSON.stringify(wrappers));
}

interface Series {
  /** Valuations ascending by date. */
  points: AccountValuation[];
  baseCurrency: string;
}

interface RatePoint {
  date: string;
  /** Foreign currency to base currency on that date. */
  rate: number;
}

interface TaxData {
  accounts: Account[];
  wrappers: WrapperMap;
  activities: ActivityDetails[];
  series: Record<string, Series>;
  baseCurrency: string;
  /** Daily rate history to base currency, keyed by the foreign currency. */
  rates: Record<string, RatePoint[]>;
  years: number[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * YYYY-MM-DD in the local calendar, which is the one a Swedish tax year is
 * counted in. Timestamps come back as the instant of local midnight, so a
 * trade on 18 July is stored as `2022-07-17T22:00:00Z` in summer - reading
 * that in UTC would file it a day early, and on 1 January, a year early.
 */
export const day = (d: Date | string): string => {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const today = (): string => day(new Date());
const amountOf = (a: ActivityDetails) => Number(a.amount ?? 0) || 0;
const quantityOf = (a: ActivityDetails) => Number(a.quantity ?? 0) || 0;

/** Latest valuation on or before `date`, or undefined when the series starts later. */
function valuationAt(series: Series | undefined, date: string): AccountValuation | undefined {
  if (!series) return undefined;
  let found: AccountValuation | undefined;
  for (const p of series.points) {
    if (day(p.valuationDate) > date) break;
    found = p;
  }
  return found;
}

export function useTaxData(ctx: AddonContext) {
  return useQuery<TaxData>({
    queryKey: ['skatt', 'data'],
    queryFn: async () => {
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
        }),
      );

      const base = Object.values(series)[0]?.baseCurrency ?? 'SEK';

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
          }),
      );

      const thisYear = new Date().getFullYear();
      const firstYear = Number(firstDate.slice(0, 4));
      const years: number[] = [];
      for (let y = thisYear; y >= firstYear; y--) years.push(y);

      return {
        accounts,
        wrappers,
        activities,
        series,
        baseCurrency: base,
        rates,
        years: years.length > 0 ? years : [thisYear],
      };
    },
  });
}

export interface TaxYearView {
  result?: TaxYearResult;
  /** True while the year is still running - quarter starts are projected. */
  partial: boolean;
  baseCurrencyWarning?: string;
}

export function useTaxYear(data: TaxData | undefined, year: number): TaxYearView {
  return useMemo(() => {
    if (!data) return { partial: false };

    const now = today();
    const partial = String(year) === now.slice(0, 4);
    const warnings: Warning[] = [];
    const warn = (category: string, detail: string) => warnings.push({ category, detail });

    const wrapperOf = (accountId: string): Wrapper => data.wrappers[accountId] ?? 'IGNORE';

    /** The rate on `date`, or the closest earlier one the history holds. */
    const rateOn = (currency: string, date: string): number | undefined => {
      // GBp / GBX is pence, a hundredth of the GBP the history is kept in.
      const pence = currency === 'GBp' || currency === 'GBX';
      const points = data.rates[pence ? 'GBP' : currency];
      if (!points?.length) return undefined;

      let found = points[0];
      for (const point of points) {
        if (point.date > date) break;
        found = point;
      }
      return pence ? found.rate / 100 : found.rate;
    };

    const toSek = (activity: ActivityDetails): number => {
      const value = amountOf(activity);
      if (activity.currency === data.baseCurrency) return value;

      const rate = rateOn(activity.currency, day(activity.date));
      if (rate !== undefined) return value * rate;

      warn(
        'Missing exchange rate',
        `No ${activity.currency} to ${data.baseCurrency} history. Those amounts are counted unconverted.`,
      );
      return value;
    };

    const inYear = data.activities.filter((a) => day(a.date).slice(0, 4) === String(year));

    // A currency conversion inside one account is booked as a withdrawal in one
    // currency and a deposit in another on the same day. That is not an
    // insattning, so those deposits are dropped before the ISK underlag is built.
    const conversionLegs = new Set<string>();
    const sameDay = new Map<string, ActivityDetails[]>();
    for (const a of inYear) {
      const key = `${a.accountId}|${day(a.date)}`;
      sameDay.set(key, [...(sameDay.get(key) ?? []), a]);
    }
    for (const group of sameDay.values()) {
      const withdrawalCurrencies = new Set(
        group.filter((a) => a.activityType === 'WITHDRAWAL').map((a) => a.currency),
      );
      for (const a of group) {
        if (a.activityType !== 'DEPOSIT') continue;
        if ([...withdrawalCurrencies].some((c) => c !== a.currency)) {
          conversionLegs.add(a.id);
          warn(
            'Deposits read as currency conversions',
            `${a.accountName}: ${a.currency} deposit on ${day(a.date)}, paired with a withdrawal ` +
              `in another currency the same day.`,
          );
        }
      }
    }

    const DAYS = 24 * 60 * 60 * 1000;

    /**
     * The other half of a securities transfer, in one of the user's own
     * accounts. Settlement puts the two legs a few days apart, so the match is
     * on security and quantity within a window rather than on an exact date.
     */
    const counterpart = (activity: ActivityDetails): ActivityDetails | undefined => {
      const opposite = activity.activityType === 'TRANSFER_IN' ? 'TRANSFER_OUT' : 'TRANSFER_IN';
      const when = new Date(`${day(activity.date)}T00:00:00Z`).getTime();
      return data.activities.find(
        (other) =>
          other.id !== activity.id &&
          other.activityType === opposite &&
          other.accountId !== activity.accountId &&
          other.assetSymbol === activity.assetSymbol &&
          Math.abs(quantityOf(other) - quantityOf(activity)) < 1e-9 &&
          Math.abs(new Date(`${day(other.date)}T00:00:00Z`).getTime() - when) <= 7 * DAYS,
      );
    };

    const landsIn = (activity: ActivityDetails): Wrapper | undefined => {
      const other = counterpart(activity);
      return other ? wrapperOf(other.accountId) : undefined;
    };

    /**
     * A share split or a broker re-booking arrives as a transfer out and a
     * transfer in of the same security in the same account: 0.044 shares leave
     * at 1766 and 0.886 arrive at 88. Nothing was disposed of - the cost basis
     * carries over and only the share count changes.
     */
    const rebookedWith = (activity: ActivityDetails): ActivityDetails | undefined => {
      const opposite = activity.activityType === 'TRANSFER_IN' ? 'TRANSFER_OUT' : 'TRANSFER_IN';
      const when = new Date(`${day(activity.date)}T00:00:00Z`).getTime();
      return data.activities.find(
        (other) =>
          other.id !== activity.id &&
          other.activityType === opposite &&
          other.accountId === activity.accountId &&
          other.assetSymbol === activity.assetSymbol &&
          Math.abs(new Date(`${day(other.date)}T00:00:00Z`).getTime() - when) <= 5 * DAYS,
      );
    };

    const isk: IskAccount[] = data.accounts
      .filter((a) => wrapperOf(a.id) === 'ISK')
      .map((account) => {
        const series = data.series[account.id];
        const projectedQuarters: number[] = [];
        const firstActivity = data.activities
          .filter((a) => a.accountId === account.id)
          .reduce<string | null>((min, a) => (!min || day(a.date) < min ? day(a.date) : min), null);

        const quarterValues = ['01-01', '04-01', '07-01', '10-01'].map((suffix, index) => {
          const date = `${year}-${suffix}`;
          if (date > now) {
            // The quarter has not started. Carry the latest known value forward
            // so the year still produces a number, flagged as a projection.
            projectedQuarters.push(index);
            return series?.points.at(-1)?.totalValueBase ?? null;
          }
          const point = valuationAt(series, date);
          if (point) return point.totalValueBase;
          // No valuation, and nothing had happened in the account yet: it was
          // genuinely empty rather than merely unrecorded.
          return firstActivity && firstActivity > date ? 0 : null;
        });

        const deposits = inYear
          .filter((a) => a.accountId === account.id)
          .filter((a) => {
            if (a.activityType === 'DEPOSIT') return !conversionLegs.has(a.id);
            // Moving securities between two of your own ISKs is not an
            // insattning - only a transfer in from elsewhere is.
            if (a.activityType === 'TRANSFER_IN') return landsIn(a) !== 'ISK';
            return false;
          })
          .reduce((sum, a) => sum + toSek(a), 0);

        return {
          accountId: account.id,
          name: account.name,
          quarterValues,
          projectedQuarters,
          deposits,
        };
      });

    const depaIds = new Set(data.accounts.filter((a) => wrapperOf(a.id) === 'DEPA').map((a) => a.id));
    const events: SecurityEvent[] = [];

    for (const a of data.activities) {
      if (!depaIds.has(a.accountId)) continue;
      const base = {
        date: day(a.date),
        symbol: a.assetSymbol,
        name: a.assetName,
        account: a.accountName,
      };
      const fee = Number(a.fee ?? 0) || 0;
      const feeSek = fee ? toSek({ ...a, amount: String(fee) }) : 0;

      switch (a.activityType) {
        case 'BUY':
          events.push({ ...base, kind: 'ACQUIRE', quantity: quantityOf(a), amountSek: toSek(a) + feeSek });
          break;
        case 'SELL':
          events.push({ ...base, kind: 'DISPOSE', quantity: quantityOf(a), amountSek: toSek(a) - feeSek });
          break;
        case 'TRANSFER_IN': {
          const rebooked = rebookedWith(a);
          if (rebooked) {
            events.push({
              ...base,
              kind: 'REBOOK',
              quantity: quantityOf(a),
              replacedQuantity: quantityOf(rebooked),
              amountSek: 0,
            });
            break;
          }
          // A transfer is never a purchase. Between two depa accounts the
          // pooled average cost already carries across, so the leg is dropped;
          // from outside, the row's own value is the only basis available.
          if (landsIn(a) !== 'DEPA') {
            events.push({ ...base, kind: 'ACQUIRE', quantity: quantityOf(a), amountSek: toSek(a) });
          }
          break;
        }
        case 'TRANSFER_OUT': {
          // The matching leg of a re-booking carries it; nothing to do here.
          if (rebookedWith(a)) break;

          // Only a move into an ISK is a disposal - the shares leave the taxable
          // wrapper at market value. Anything else just leaves the pool.
          const destination = landsIn(a);
          if (destination === 'ISK') {
            events.push({ ...base, kind: 'DISPOSE', quantity: quantityOf(a), amountSek: toSek(a) });
          } else if (destination !== 'DEPA') {
            events.push({ ...base, kind: 'REMOVE', quantity: quantityOf(a), amountSek: 0 });
            warn(
              'Transfers out that went nowhere traceable',
              `${a.accountName}: ${a.assetSymbol} left on ${day(a.date)} and arrived in ` +
                `${destination === 'IGNORE' ? 'an account that is not tracked here' : 'no tracked account'}. ` +
                `Removed from the holding, not counted as a sale.`,
            );
          }
          break;
        }
        case 'SPLIT':
          warn(
            'Splits not applied',
            `${a.accountName}: ${a.assetSymbol} split on ${day(a.date)} does not adjust the cost basis.`,
          );
          break;
      }
    }

    const sumInYear = (predicate: (a: ActivityDetails) => boolean) =>
      inYear.filter(predicate).reduce((sum, a) => sum + toSek(a), 0);

    const result = computeTaxYear({
      year,
      isk,
      events,
      dividendsSek: sumInYear((a) => depaIds.has(a.accountId) && a.activityType === 'DIVIDEND'),
      interestSek: sumInYear((a) => depaIds.has(a.accountId) && a.activityType === 'INTEREST'),
      iskWithholdingSek: sumInYear(
        (a) => wrapperOf(a.accountId) === 'ISK' && a.activityType === 'TAX',
      ),
      depaFeesSek: sumInYear((a) => depaIds.has(a.accountId) && a.activityType === 'FEE'),
    });

    const seen = new Set<string>();
    const merged = [...result.warnings, ...warnings].filter((w) => {
      const key = `${w.category}|${w.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      result: { ...result, warnings: merged },
      partial,
      baseCurrencyWarning:
        data.baseCurrency === 'SEK'
          ? undefined
          : `Your base currency is ${data.baseCurrency}. Swedish tax is assessed in SEK, so every ` +
            `figure below is in ${data.baseCurrency} and will not match a declaration.`,
    };
  }, [data, year]);
}
