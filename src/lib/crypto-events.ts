import type { ActivityDetails } from '@wealthfolio/addon-sdk';
import { feeOf, quantityOf, amountOf } from './activities';
import { day } from './dates';
import type { IncomeRow, SecurityEvent, Warning } from './swedish-tax';

export interface CryptoHelpers {
  /** Converts an activity's amount to the base currency at its own date. */
  toSek: (activity: ActivityDetails) => number;
  /** True when the other leg of this transfer is one of your own crypto accounts. */
  landsInCrypto: (activity: ActivityDetails) => boolean;
  /** The matching leg of a same-account, same-security re-booking, if there is one. */
  rebookedWith: (activity: ActivityDetails) => ActivityDetails | undefined;
}

export interface CryptoEvents {
  events: SecurityEvent[];
  /** Staking, earn and airdrop receipts. Dated, so the caller picks the year. */
  rewards: (IncomeRow & { sek: number })[];
  warnings: Warning[];
}

/**
 * Turns the activities of every account marked Crypto into K4 avsnitt D
 * events.
 *
 * Pure, and separate from the hook, because this is where the judgement calls
 * live - what counts as a swap, what counts as a reward - and they are worth
 * testing directly rather than through a React query.
 */
export function buildCryptoEvents(
  activities: ActivityDetails[],
  helpers: CryptoHelpers,
): CryptoEvents {
  const { toSek, landsInCrypto, rebookedWith } = helpers;
  const events: SecurityEvent[] = [];
  const rewards: (IncomeRow & { sek: number })[] = [];
  const warnings: Warning[] = [];

  /**
   * A crypto-to-crypto swap arrives as a transfer out of one coin and a
   * transfer in of another, same account, same day - exchanges book a
   * "convert" and a token rebrand identically. Several transfers can land on
   * the same day (a monthly reward drip alongside a real swap), so each
   * outgoing leg takes the incoming leg closest to it in value rather than
   * whichever the list happens to hold first.
   */
  const swapFor = new Map<string, ActivityDetails>();
  const swapLegIn = new Set<string>();
  const byDay = new Map<string, ActivityDetails[]>();
  for (const a of activities) {
    if (a.activityType !== 'TRANSFER_IN' && a.activityType !== 'TRANSFER_OUT') continue;
    const key = `${a.accountId}|${day(a.date)}`;
    byDay.set(key, [...(byDay.get(key) ?? []), a]);
  }
  for (const group of byDay.values()) {
    const available = group.filter((a) => a.activityType === 'TRANSFER_IN');
    for (const out of group.filter((a) => a.activityType === 'TRANSFER_OUT')) {
      const outSek = toSek(out);
      let best: ActivityDetails | undefined;
      let bestGap = Infinity;
      for (const candidate of available) {
        if (candidate.assetSymbol === out.assetSymbol) continue;
        if (swapLegIn.has(candidate.id)) continue;
        const gap = Math.abs(toSek(candidate) - outSek);
        if (gap < bestGap) {
          best = candidate;
          bestGap = gap;
        }
      }
      if (best) {
        swapFor.set(out.id, best);
        swapLegIn.add(best.id);
      }
    }
  }

  for (const a of activities) {
    const base = {
      date: day(a.date),
      symbol: a.assetSymbol,
      name: a.assetName,
      account: a.accountName,
    };
    const fee = feeOf(a);
    const feeSek = fee ? toSek({ ...a, amount: String(fee) }) : 0;

    switch (a.activityType) {
      case 'BUY':
        events.push({
          ...base,
          kind: 'ACQUIRE',
          quantity: quantityOf(a),
          amountSek: toSek(a) + feeSek,
        });
        break;
      case 'SELL':
        events.push({
          ...base,
          kind: 'DISPOSE',
          quantity: quantityOf(a),
          amountSek: toSek(a) - feeSek,
        });
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
        // Moving a coin between two of your own wallets is not an
        // acquisition - the pooled average cost already carries across.
        if (landsInCrypto(a)) break;

        if (swapLegIn.has(a.id)) {
          // The coin received in a swap. Its omkostnadsbelopp is what it was
          // worth when it arrived, which is also the disposal value booked
          // on the outgoing leg below.
          events.push({ ...base, kind: 'ACQUIRE', quantity: quantityOf(a), amountSek: toSek(a) });
          break;
        }

        // Nothing left it could have come from: a staking, earn or airdrop
        // reward. Taxed as capital income the year it lands, and that same
        // value becomes the coin's omkostnadsbelopp.
        const valueSek = toSek(a);
        rewards.push({
          ...base,
          quantity: quantityOf(a),
          amountSek: valueSek,
          sek: valueSek,
          kind: 'Reward',
        });
        events.push({ ...base, kind: 'ACQUIRE', quantity: quantityOf(a), amountSek: valueSek });
        break;
      }
      case 'TRANSFER_OUT': {
        if (rebookedWith(a)) break;
        if (landsInCrypto(a)) break;

        const received = swapFor.get(a.id);
        if (received) {
          // Forsaljningspriset is the market value of what you got in
          // exchange, not what the coin you gave up was quoted at.
          events.push({
            ...base,
            kind: 'DISPOSE',
            quantity: quantityOf(a),
            amountSek: toSek(received),
          });
          break;
        }

        events.push({ ...base, kind: 'REMOVE', quantity: quantityOf(a), amountSek: 0 });
        warnings.push({
          category: 'Crypto that left without a traceable destination',
          detail:
            `${a.accountName}: ${a.assetSymbol} left on ${base.date} and arrived in no tracked ` +
            `account. Removed from the holding, not counted as a sale - check whether it was one.`,
        });
        break;
      }
      case 'SPLIT': {
        const ratio = amountOf(a);
        if (ratio > 0) events.push({ ...base, kind: 'SPLIT', quantity: ratio, amountSek: 0 });
        break;
      }
    }
  }

  return { events, rewards, warnings };
}
