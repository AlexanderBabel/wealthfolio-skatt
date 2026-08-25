import { describe, expect, it } from 'vitest';
import { buildCryptoEvents } from './crypto-events';

/**
 * Fixtures are synthetic on purpose: placeholder tickers, a placeholder
 * exchange, and round numbers. This is a public repository, so a test must
 * never carry anyone's real holdings, tickers, quantities or account names.
 * The *shapes* here are what matters, and they are what an exchange export
 * produces: a recurring reward drip, a dust conversion landing on the same
 * day as one, a token rebrand, and plain sales.
 */
type Activity = Parameters<typeof buildCryptoEvents>[0][number];

// The SDK type keeps amounts as strings and the date as a Date. Writing the
// fixtures the way the importer actually produces them is more readable than
// satisfying that shape, so the cast happens once, here.
const activity = (a: Record<string, unknown>): Activity =>
  ({
    accountId: 'exchange-1',
    accountName: 'Exchange',
    assetId: 'x',
    assetSymbol: 'AAA',
    currency: 'EUR',
    fee: 0,
    quantity: 1,
    amount: 1,
    date: '2026-01-15T23:00:00+00:00',
    ...a,
  }) as unknown as Activity;

// One EUR is ten SEK here, so a converted amount is obvious at a glance.
const helpers = {
  toSek: (a: Activity) => (Number(a.amount ?? 0) || 0) * 10,
  landsInCrypto: () => false,
  rebookedWith: () => undefined,
};

describe('buildCryptoEvents', () => {
  it('turns a plain sale into a disposal', () => {
    const { events } = buildCryptoEvents(
      [activity({ id: '1', activityType: 'SELL', assetSymbol: 'AAA', quantity: 2, amount: 15 })],
      helpers,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'DISPOSE', symbol: 'AAA', amountSek: 150 });
  });

  it('books an unmatched incoming transfer as a reward, at its value on arrival', () => {
    const { events, rewards } = buildCryptoEvents(
      [
        activity({
          id: '1',
          activityType: 'TRANSFER_IN',
          quantity: 50,
          amount: 3,
          date: '2026-05-31T22:00:00+00:00',
        }),
      ],
      helpers,
    );

    expect(rewards).toHaveLength(1);
    expect(rewards[0].date).toBe('2026-06-01');
    expect(rewards[0].sek).toBeCloseTo(30, 9);
    // Also enters the pool at that value, so it is not taxed twice on sale.
    expect(events[0]).toMatchObject({ kind: 'ACQUIRE' });
    expect(events[0].amountSek).toBeCloseTo(30, 9);
  });

  it('pairs a same-day swap and prices the disposal at what came back', () => {
    const { events, rewards } = buildCryptoEvents(
      [
        activity({ id: 'out', activityType: 'TRANSFER_OUT', assetSymbol: 'BBB', quantity: 4, amount: 5 }),
        activity({ id: 'in', activityType: 'TRANSFER_IN', assetSymbol: 'AAA', quantity: 9, amount: 6 }),
      ],
      helpers,
    );

    const disposal = events.find((e) => e.kind === 'DISPOSE');
    const acquire = events.find((e) => e.kind === 'ACQUIRE');
    // Value of what was received (6), not what the coin given up was quoted at (5).
    expect(disposal).toMatchObject({ symbol: 'BBB', amountSek: 60 });
    expect(acquire).toMatchObject({ symbol: 'AAA', amountSek: 60 });
    // The incoming leg is the other half of a swap, so it is not also a reward.
    expect(rewards).toEqual([]);
  });

  it('does not mistake a reward drip for the other half of a swap', () => {
    // A rebrand (BBB -> CCC) with a small recurring reward landing the same
    // day. Matching on list order alone would pair BBB with the reward and
    // leave CCC looking like income.
    const { events, rewards } = buildCryptoEvents(
      [
        activity({ id: 'drip', activityType: 'TRANSFER_IN', assetSymbol: 'AAA', quantity: 1, amount: 0.5 }),
        activity({ id: 'old', activityType: 'TRANSFER_OUT', assetSymbol: 'BBB', quantity: 20, amount: 140 }),
        activity({ id: 'new', activityType: 'TRANSFER_IN', assetSymbol: 'CCC', quantity: 20, amount: 110 }),
      ],
      helpers,
    );

    const disposal = events.find((e) => e.kind === 'DISPOSE');
    expect(disposal).toMatchObject({ symbol: 'BBB', amountSek: 1100 }); // paired with CCC
    expect(rewards).toHaveLength(1); // only the drip, not CCC
    expect(rewards[0].sek).toBeCloseTo(5, 9);
    expect(events.filter((e) => e.kind === 'ACQUIRE').map((e) => e.symbol).sort()).toEqual([
      'AAA',
      'CCC',
    ]);
  });

  it('treats a move between two of your own wallets as neither sale nor reward', () => {
    const ownWallet = { ...helpers, landsInCrypto: () => true };
    const { events, rewards } = buildCryptoEvents(
      [
        activity({ id: 'out', activityType: 'TRANSFER_OUT', assetSymbol: 'AAA', quantity: 1, amount: 500 }),
        activity({
          id: 'in',
          accountId: 'wallet-2',
          activityType: 'TRANSFER_IN',
          assetSymbol: 'AAA',
          quantity: 1,
          amount: 500,
        }),
      ],
      ownWallet,
    );

    expect(events).toEqual([]);
    expect(rewards).toEqual([]);
  });

  it('warns rather than guessing when a coin leaves for nowhere traceable', () => {
    const { events, warnings } = buildCryptoEvents(
      [activity({ id: '1', activityType: 'TRANSFER_OUT', assetSymbol: 'AAA', quantity: 300, amount: 75 })],
      helpers,
    );

    expect(events[0]).toMatchObject({ kind: 'REMOVE', amountSek: 0 });
    expect(warnings[0].category).toBe('Crypto that left without a traceable destination');
  });
});
