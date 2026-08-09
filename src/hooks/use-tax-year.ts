import { useQuery } from '@tanstack/react-query';
import type { Account, AccountValuation, ActivityDetails, AddonContext } from '@wealthfolio/addon-sdk';
import { useMemo } from 'react';
import {
  computeTaxYear,
  MissingRateError,
  type IskAccount,
  type SecurityEvent,
  type TaxYearResult,
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

interface TaxData {
  accounts: Account[];
  wrappers: WrapperMap;
  activities: ActivityDetails[];
  series: Record<string, Series>;
  baseCurrency: string;
  rates: Record<string, number>;
  years: number[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * YYYY-MM-DD. Activity and valuation dates arrive as UTC midnight, so they are
 * read in UTC; `today()` is the local calendar day, which is what a tax year
 * means to the person reading the page.
 */
export const day = (d: Date | string): string => {
  if (typeof d === 'string') return d.slice(0, 10);
  const date = d instanceof Date ? d : new Date(d);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
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

      const rates: Record<string, number> = {};
      for (const r of exchangeRates) {
        if (r.toCurrency === 'SEK') rates[r.fromCurrency] = r.rate;
        else if (r.fromCurrency === 'SEK' && r.rate) rates[r.toCurrency] = 1 / r.rate;
      }

      const thisYear = new Date().getFullYear();
      const firstYear = Number(firstDate.slice(0, 4));
      const years: number[] = [];
      for (let y = thisYear; y >= firstYear; y--) years.push(y);

      return {
        accounts,
        wrappers,
        activities,
        series,
        baseCurrency: Object.values(series)[0]?.baseCurrency ?? 'SEK',
        rates,
        years: years.length > 0 ? years : [thisYear],
      };
    },
  });
}

export interface TaxYearView {
  result?: TaxYearResult;
  error?: string;
  /** True while the year is still running - quarter starts are projected. */
  partial: boolean;
  baseCurrencyWarning?: string;
}

export function useTaxYear(data: TaxData | undefined, year: number): TaxYearView {
  return useMemo(() => {
    if (!data) return { partial: false };

    const now = today();
    const partial = String(year) === now.slice(0, 4);
    const warnings: string[] = [];

    const wrapperOf = (accountId: string): Wrapper => data.wrappers[accountId] ?? 'IGNORE';
    const byId = new Map(data.accounts.map((a) => [a.id, a]));

    /**
     * Amounts are converted with the account's own daily rate to base currency,
     * which the valuation series carries. An activity in some third currency
     * falls back to today's rate, which is wrong for old rows - hence a warning.
     */
    const toSek = (activity: ActivityDetails): number => {
      const value = amountOf(activity);
      if (activity.currency === data.baseCurrency) return value;

      const account = byId.get(activity.accountId);
      if (account && activity.currency === account.currency) {
        const point = valuationAt(data.series[activity.accountId], day(activity.date));
        if (point?.fxRateToBase) return value * point.fxRateToBase;
      }

      const rate = data.rates[activity.currency];
      if (rate) {
        warnings.push(
          `${activity.currency} amount on ${day(activity.date)} converted at today's rate.`,
        );
        return value * rate;
      }
      warnings.push(`No ${activity.currency} to ${data.baseCurrency} rate, amount left unconverted.`);
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
          warnings.push(
            `${a.accountName}: deposit of ${a.currency} on ${day(a.date)} treated as a currency ` +
              `conversion, not an insattning.`,
          );
        }
      }
    }

    /** Securities moved between two of the user's own accounts of some wrapper. */
    const movedBetween = (activity: ActivityDetails, wrapper: Wrapper): boolean => {
      const opposite = activity.activityType === 'TRANSFER_IN' ? 'TRANSFER_OUT' : 'TRANSFER_IN';
      return data.activities.some(
        (other) =>
          other.id !== activity.id &&
          other.activityType === opposite &&
          other.accountId !== activity.accountId &&
          wrapperOf(other.accountId) === wrapper &&
          day(other.date) === day(activity.date) &&
          other.assetSymbol === activity.assetSymbol &&
          Math.abs(quantityOf(other) - quantityOf(activity)) < 1e-9,
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
            if (a.activityType === 'TRANSFER_IN') return !movedBetween(a, 'ISK');
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
      const base = { date: day(a.date), symbol: a.assetSymbol, name: a.assetName };
      const fee = Number(a.fee ?? 0) || 0;
      const feeSek = fee ? toSek({ ...a, amount: String(fee) }) : 0;

      switch (a.activityType) {
        case 'BUY':
          events.push({ ...base, kind: 'ACQUIRE', quantity: quantityOf(a), amountSek: toSek(a) + feeSek });
          break;
        case 'SELL':
          events.push({ ...base, kind: 'DISPOSE', quantity: quantityOf(a), amountSek: toSek(a) - feeSek });
          break;
        case 'TRANSFER_IN':
          // Between two depa accounts the pooled average cost already covers
          // it; from outside, the cost basis is whatever came with the row.
          if (!movedBetween(a, 'DEPA')) {
            events.push({ ...base, kind: 'ACQUIRE', quantity: quantityOf(a), amountSek: toSek(a) });
          }
          break;
        case 'TRANSFER_OUT':
          // Moving securities out of a depa into an ISK is a disposal at market
          // value; moving them to another depa is not.
          if (!movedBetween(a, 'DEPA')) {
            events.push({ ...base, kind: 'DISPOSE', quantity: quantityOf(a), amountSek: toSek(a) });
          }
          break;
        case 'SPLIT':
          warnings.push(`${a.assetSymbol}: split on ${day(a.date)} is not applied to the cost basis.`);
          break;
      }
    }

    const sumInYear = (predicate: (a: ActivityDetails) => boolean) =>
      inYear.filter(predicate).reduce((sum, a) => sum + toSek(a), 0);

    try {
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

      return {
        result: { ...result, warnings: [...new Set([...result.warnings, ...warnings])] },
        partial,
        baseCurrencyWarning:
          data.baseCurrency === 'SEK'
            ? undefined
            : `Your base currency is ${data.baseCurrency}. Swedish tax is assessed in SEK, so every ` +
              `figure below is in ${data.baseCurrency} and will not match a declaration.`,
      };
    } catch (error) {
      if (error instanceof MissingRateError) return { error: error.message, partial };
      throw error;
    }
  }, [data, year]);
}
