import type { ActivityDetails } from '@wealthfolio/addon-sdk';
import { useMemo } from 'react';
import { amountOf, quantityOf } from '../lib/activities';
import { buildCryptoEvents } from '../lib/crypto-events';
import { day, today } from '../lib/dates';
import {
  computeTaxYear,
  quantityBefore,
  type FundHolding,
  type IncomeRow,
  type IskAccount,
  type SecurityEvent,
  type TaxYearResult,
  type Warning,
  type Wrapper,
} from '../lib/swedish-tax';
import { FUND_NAME_PATTERN, valuationAt, type TaxData } from './use-tax-data';

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
    const symbolNames = new Map<string, string>();

    for (const a of data.activities) {
      if (!depaIds.has(a.accountId)) continue;
      if (a.assetName && !symbolNames.has(a.assetSymbol)) symbolNames.set(a.assetSymbol, a.assetName);
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
        case 'SPLIT': {
          // The ratio rides in on `amount`: 4 for a 4:1 split, 1/12 for a
          // 1:12 reverse split.
          const ratio = amountOf(a);
          if (ratio > 0) {
            events.push({ ...base, kind: 'SPLIT', quantity: ratio, amountSek: 0 });
          } else {
            warn(
              'Splits without a ratio',
              `${a.accountName}: ${a.assetSymbol} split on ${day(a.date)} carries no ratio, so the ` +
                `cost basis per share is left as it was.`,
            );
          }
          break;
        }
      }
    }

    // --- Crypto (K4 avsnitt D) ------------------------------------------
    // Its own average-cost pool, kept apart from the depa one: a coin and a
    // share never pool together, and avsnitt D has different rules on both
    // losses and omkostnadsbelopp.
    const cryptoIds = new Set(
      data.accounts.filter((a) => wrapperOf(a.id) === 'CRYPTO').map((a) => a.id),
    );
    const crypto = buildCryptoEvents(
      data.activities.filter((a) => cryptoIds.has(a.accountId)),
      {
        toSek,
        landsInCrypto: (a) => landsIn(a) === 'CRYPTO',
        rebookedWith,
      },
    );
    const cryptoEvents = crypto.events;
    const cryptoRewardRows = crypto.rewards.filter((r) => r.date.slice(0, 4) === String(year));
    const cryptoRewardsSek = cryptoRewardRows.reduce((sum, r) => sum + r.sek, 0);
    warnings.push(...crypto.warnings);

    if (cryptoRewardsSek > 0) {
      warn(
        'Crypto rewards booked as capital income',
        `${Math.round(cryptoRewardsSek)} ${data.baseCurrency} of staking/earn/airdrop rewards are ` +
          `taxed as capital income for ${year} and carried into the pool at that value. Mined coins ` +
          `belong in inkomst av tjanst instead, and a pure airdrop you did nothing for is normally ` +
          `untaxed at receipt with omkostnadsbelopp 0 - adjust those by hand.`,
      );
    }

    // The individual payments behind the dividend and interest totals. Same
    // filter as the sums below, so the table and the figure cannot disagree.
    const incomeRows: IncomeRow[] = inYear
      .filter(
        (a) =>
          depaIds.has(a.accountId) &&
          (a.activityType === 'DIVIDEND' || a.activityType === 'INTEREST'),
      )
      .map((a) => ({
        date: day(a.date),
        symbol: a.assetSymbol,
        name: a.assetName,
        account: a.accountName,
        amountSek: toSek(a),
        kind: a.activityType === 'DIVIDEND' ? 'Dividend' : 'Interest',
      }));

    const sumInYear = (predicate: (a: ActivityDetails) => boolean) =>
      inYear.filter(predicate).reduce((sum, a) => sum + toSek(a), 0);

    // Fund schablonintakt is charged on fund/ETF units held directly in a depa
    // at 1 January - the same quantity replay computeDisposals uses, priced
    // with the closest quote on or before that date.
    const jan1 = `${year}-01-01`;
    const fundHoldings: FundHolding[] = [];
    for (const [symbol, quantity] of quantityBefore(events, jan1)) {
      if (quantity <= 0) continue;
      const info = data.assets[symbol];
      if (!info?.isFund) {
        // Wealthfolio's own classification is trusted enough to rule a fund
        // out even when the name looks like one - but that disagreement is
        // worth a look, since it is the one place a wrong upstream
        // classification would otherwise disappear without a trace.
        if (info?.typeKnown && FUND_NAME_PATTERN.test(symbolNames.get(symbol) ?? '')) {
          warn(
            'Classified as not a fund, but the name suggests otherwise',
            `${symbol}${info.typeLabel ? ` (${info.typeLabel})` : ''}: looks like a fund/ETF by name. ` +
              `Check whether it needs the 0.4 % fund schablonintakt added by hand.`,
          );
        }
        continue;
      }
      if (!info.typeKnown) {
        warn(
          'Fund holdings of unknown type',
          `${symbol}: neither Wealthfolio's own classification nor the market data provider says ` +
            `what this is, so it is assumed not to be a fund. Check whether it needs the 0.4 % fund ` +
            `schablonintakt added by hand.`,
        );
        continue;
      }

      const price = info.quotes.filter((q) => q.date <= jan1).at(-1)?.close;
      if (price === undefined) {
        warn('Fund holdings with no price on 1 January', `${symbol}: no quote on or before ${jan1}.`);
        continue;
      }

      const rate = info.currency === data.baseCurrency ? 1 : rateOn(info.currency, jan1);
      if (rate === undefined) {
        warn(
          'Missing exchange rate',
          `No ${info.currency} to ${data.baseCurrency} history for ${symbol}'s fund schablonintakt.`,
        );
        continue;
      }

      fundHoldings.push({
        symbol,
        name: symbolNames.get(symbol),
        typeLabel: info.typeLabel,
        quantity,
        priceSek: price * rate,
      });
    }

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
      fundHoldings,
      incomeRows,
      cryptoEvents,
      cryptoRewardsSek,
      cryptoRewardRows,
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
