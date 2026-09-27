import type { ActivityDetails } from '@wealthfolio/addon-sdk';
import { describe, expect, it } from 'vitest';
import type { TaxData } from './use-tax-data';
import { computeTaxYearView } from './use-tax-year';

/**
 * Synthetic fixtures only - placeholder tickers and round numbers. What is
 * under test is the glue between the loaded portfolio and the tax engine:
 * currency conversion at the trade's own date, pairing the two legs of a
 * transfer, and reading quarter-start values.
 */
const activity = (a: Record<string, unknown>): ActivityDetails =>
  ({
    id: Math.random().toString(36).slice(2),
    accountId: 'depa',
    accountName: 'Depa',
    assetId: 'AAA',
    assetSymbol: 'AAA',
    currency: 'SEK',
    fee: 0,
    quantity: 1,
    amount: 0,
    ...a,
  }) as unknown as ActivityDetails;

const data = (overrides: Partial<TaxData>): TaxData =>
  ({
    accounts: [
      { id: 'depa', name: 'Depa' },
      { id: 'isk', name: 'Isk' },
      { id: 'isk2', name: 'Isk 2' },
    ],
    wrappers: { depa: 'DEPA', isk: 'ISK', isk2: 'ISK' },
    activities: [],
    series: {},
    baseCurrency: 'SEK',
    rates: {},
    assets: {},
    years: [2024],
    ...overrides,
  }) as TaxData;

const view = (d: Partial<TaxData>) => computeTaxYearView(data(d), 2024).result!;

describe('computeTaxYearView', () => {
  it('converts each trade at the rate on its own date', () => {
    const result = view({
      rates: {
        EUR: [
          { date: '2024-01-01', rate: 11 },
          { date: '2024-03-01', rate: 12 },
          { date: '2024-06-01', rate: 13 },
        ],
      },
      activities: [
        activity({ activityType: 'BUY', date: '2024-03-10', currency: 'EUR', quantity: 10, amount: 100 }),
        activity({ activityType: 'SELL', date: '2024-06-05', currency: 'EUR', quantity: 10, amount: 150 }),
      ],
    });
    expect(result.depa.rows).toHaveLength(1);
    expect(result.depa.rows[0].omkostnadsbelopp).toBeCloseTo(1200);
    expect(result.depa.rows[0].forsaljningspris).toBeCloseTo(1950);
  });

  it('counts only deposits from outside the ISKs as insattningar', () => {
    const result = view({
      activities: [
        activity({ accountId: 'isk', activityType: 'DEPOSIT', date: '2024-02-01', amount: 1000 }),
        // Between two of your own ISKs: not an insattning. The legs settle days apart.
        activity({ accountId: 'isk2', activityType: 'TRANSFER_OUT', date: '2024-04-01', quantity: 3, amount: 300 }),
        activity({ accountId: 'isk', activityType: 'TRANSFER_IN', date: '2024-04-04', quantity: 3, amount: 300 }),
        // From nowhere tracked: an insattning.
        activity({ accountId: 'isk', activityType: 'TRANSFER_IN', date: '2024-05-01', assetSymbol: 'BBB', quantity: 2, amount: 50 }),
      ],
    });
    const isk = result.isk.accounts.find((a) => a.accountId === 'isk')!;
    expect(isk.deposits).toBe(1050);
  });

  it('treats a move from a depa into an ISK as a sale at market value', () => {
    const result = view({
      activities: [
        activity({ activityType: 'BUY', date: '2024-01-10', quantity: 5, amount: 500 }),
        activity({ activityType: 'TRANSFER_OUT', date: '2024-05-01', quantity: 5, amount: 800 }),
        activity({ accountId: 'isk', activityType: 'TRANSFER_IN', date: '2024-05-03', quantity: 5, amount: 800 }),
      ],
    });
    expect(result.depa.rows.map((r) => [r.forsaljningspris, r.omkostnadsbelopp])).toEqual([[800, 500]]);
    expect(result.isk.accounts.find((a) => a.accountId === 'isk')!.deposits).toBe(800);
  });

  it('reads a same-account transfer out and in as a re-booking, not a sale', () => {
    const result = view({
      activities: [
        activity({ activityType: 'BUY', date: '2024-01-10', quantity: 1, amount: 1000 }),
        activity({ activityType: 'TRANSFER_OUT', date: '2024-03-01', quantity: 1, amount: 1100 }),
        activity({ activityType: 'TRANSFER_IN', date: '2024-03-02', quantity: 20, amount: 1100 }),
        activity({ activityType: 'SELL', date: '2024-06-01', quantity: 20, amount: 1500 }),
      ],
    });
    expect(result.depa.rows.map((r) => [r.quantity, r.omkostnadsbelopp])).toEqual([[20, 1000]]);
    expect(result.warnings.map((w) => w.category)).not.toContain('Transfers out that went nowhere traceable');
  });

  it('takes each quarter start from the latest valuation on or before it', () => {
    const point = (valuationDate: string, totalValueBase: number) => ({ valuationDate, totalValueBase });
    const result = view({
      series: {
        isk: {
          baseCurrency: 'SEK',
          points: [
            point('2023-12-29', 100),
            point('2024-03-28', 200),
            point('2024-04-01', 250),
            point('2024-06-15', 300),
            point('2024-09-30', 400),
          ] as TaxData['series'][string]['points'],
        },
      },
    });
    expect(result.isk.accounts.find((a) => a.accountId === 'isk')!.quarterValues).toEqual([100, 250, 300, 400]);
  });

  it('prices a fund held on 1 January at the last quote before it, in SEK', () => {
    const result = view({
      rates: { EUR: [{ date: '2023-12-01', rate: 11 }] },
      assets: {
        FND: {
          currency: 'EUR',
          isFund: true,
          typeKnown: true,
          quotes: [
            { date: '2023-12-28', close: 9 },
            { date: '2023-12-29', close: 10 },
            { date: '2024-01-02', close: 99 },
          ],
        },
      },
      activities: [activity({ activityType: 'BUY', date: '2023-06-01', assetSymbol: 'FND', quantity: 4, amount: 400 })],
    });
    expect(result.depa.fundHoldings.map((f) => [f.symbol, f.valueSek])).toEqual([['FND', 440]]);
  });
});
