import { describe, expect, it } from 'vitest';
import {
  computeDisposals,
  computeTaxYear,
  fribelopp,
  schablonRate,
  type IskAccount,
  type SecurityEvent,
  type TaxYearInput,
} from './swedish-tax';

const isk = (name: string, quarterValue: number, deposits = 0): IskAccount => ({
  accountId: name,
  name,
  quarterValues: [quarterValue, quarterValue, quarterValue, quarterValue],
  projectedQuarters: [],
  deposits,
});

const emptyYear = (year: number): TaxYearInput => ({
  year,
  isk: [],
  events: [],
  dividendsSek: 0,
  interestSek: 0,
  iskWithholdingSek: 0,
  depaFeesSek: 0,
});

describe('schablonintakt rate', () => {
  it('is the 30 November state loan rate plus one point', () => {
    expect(schablonRate(2026)).toBeCloseTo(0.0355, 10); // 2.55 % + 1
    expect(schablonRate(2024)).toBeCloseTo(0.0362, 10); // 2.62 % + 1
  });

  it('never falls below the 1.25 % floor', () => {
    expect(schablonRate(2022)).toBeCloseTo(0.0125, 10); // 0.23 % + 1 = 1.23 %
    expect(schablonRate(2021)).toBeCloseTo(0.0125, 10); // negative rate
  });

  it('is unknown for a year whose rate has not been published yet', () => {
    expect(schablonRate(2099)).toBeNull();
    expect(fribelopp(2099)).toBeNull();
    expect(() => computeTaxYear(emptyYear(2099))).toThrow(/statslaneranta/);
  });

  it('has no fribelopp before 2025', () => {
    expect(fribelopp(2024)).toBe(0);
    expect(fribelopp(2026)).toBe(300_000);
  });
});

describe('ISK', () => {
  it('computes a full year by hand', () => {
    // Four quarter starts of 100 000 plus 40 000 deposited during the year:
    // kapitalunderlag (400 000 + 40 000) / 4 = 110 000, taxed at 3.62 %.
    const result = computeTaxYear({ ...emptyYear(2024), isk: [isk('A', 100_000, 40_000)] });

    expect(result.isk.kapitalunderlag).toBe(110_000);
    expect(result.isk.schablonintakt).toBeCloseTo(3982, 6);
    expect(result.tax).toBeCloseTo(1194.6, 6);
  });

  it('splits one fribelopp across several accounts in proportion', () => {
    const result = computeTaxYear({
      ...emptyYear(2026),
      isk: [isk('A', 200_000), isk('B', 100_000), isk('C', 50_000), isk('D', 50_000)],
    });

    expect(result.isk.kapitalunderlag).toBe(400_000);
    expect(result.isk.accounts.map((a) => a.fribeloppShare)).toEqual([
      150_000, 75_000, 37_500, 37_500,
    ]);
    // 400 000 - 300 000 = 100 000 left to tax, wherever it sits.
    const taxable = result.isk.accounts.reduce((s, a) => s + a.taxableUnderlag, 0);
    expect(taxable).toBeCloseTo(100_000, 6);
    expect(result.isk.schablonintakt).toBeCloseTo(3550, 6);
  });

  it('never turns a fribelopp larger than the underlag into a negative', () => {
    const result = computeTaxYear({ ...emptyYear(2026), isk: [isk('A', 10_000)] });

    expect(result.isk.accounts[0].taxableUnderlag).toBe(0);
    expect(result.tax).toBe(0);
  });

  it('treats withdrawals as irrelevant and deposits as additive', () => {
    // Deposits enter the underlag whole; there is no withdrawal input at all.
    const result = computeTaxYear({ ...emptyYear(2024), isk: [isk('A', 0, 100_000)] });
    expect(result.isk.kapitalunderlag).toBe(25_000);
  });
});

describe('genomsnittsmetoden', () => {
  const buy = (date: string, quantity: number, amountSek: number): SecurityEvent => ({
    date,
    symbol: 'AAA',
    account: 'Broker',
    kind: 'ACQUIRE',
    quantity,
    amountSek,
  });
  const sell = (date: string, quantity: number, amountSek: number): SecurityEvent => ({
    date,
    symbol: 'AAA',
    account: 'Broker',
    kind: 'DISPOSE',
    quantity,
    amountSek,
  });

  it('uses the average cost of the whole pooled holding', () => {
    const { rows } = computeDisposals(
      [buy('2025-01-10', 10, 1000), buy('2025-06-10', 10, 2000), sell('2026-03-01', 5, 900)],
      2026,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].omkostnadsbelopp).toBeCloseTo(750, 6); // 5 x (3000 / 20)
    expect(rows[0].result).toBeCloseTo(150, 6);
  });

  it('keeps the average intact for the shares still held', () => {
    const { rows } = computeDisposals(
      [
        buy('2025-01-10', 10, 1000),
        buy('2025-06-10', 10, 2000),
        sell('2026-03-01', 5, 900),
        sell('2026-09-01', 15, 3000),
      ],
      2026,
    );

    expect(rows[1].omkostnadsbelopp).toBeCloseTo(2250, 6); // 15 x 150, unchanged
    expect(rows[1].result).toBeCloseTo(750, 6);
  });

  it('ignores disposals from other years but keeps their effect on the average', () => {
    const { rows } = computeDisposals(
      [buy('2024-01-10', 10, 1000), sell('2025-01-10', 5, 800), sell('2026-01-10', 5, 800)],
      2026,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-01-10');
    expect(rows[0].omkostnadsbelopp).toBeCloseTo(500, 6);
  });

  it('flags where schablonmetoden would be the better choice', () => {
    const { rows } = computeDisposals([buy('2020-01-01', 10, 100), sell('2026-01-01', 10, 1000)], 2026);

    expect(rows[0].omkostnadsbelopp).toBeCloseTo(100, 6);
    expect(rows[0].schablonOmkostnad).toBeCloseTo(200, 6);
    expect(rows[0].schablonBetter).toBe(true);
  });

  it('falls back to schablonmetoden and warns when the purchase is missing', () => {
    const { rows, warnings } = computeDisposals([sell('2026-01-01', 10, 1000)], 2026);

    expect(rows[0].omkostnadsbelopp).toBeCloseTo(200, 6);
    expect(warnings[0].category).toBe('Sales with no purchase on record');
    expect(warnings[0].detail).toContain('Broker');
  });

  it('takes transferred-out shares off the pool without calling it a sale', () => {
    const { rows } = computeDisposals(
      [
        buy('2025-01-10', 10, 1000),
        { ...sell('2026-03-01', 6, 0), kind: 'REMOVE' },
        sell('2026-06-01', 4, 800),
      ],
      2026,
    );

    // Only the real sale is reported, and it still costs 100 a share.
    expect(rows).toHaveLength(1);
    expect(rows[0].omkostnadsbelopp).toBeCloseTo(400, 6);
  });
});

describe('capital income', () => {
  it('offsets losses against gains in full, then quotes the rest to 70 %', () => {
    const result = computeTaxYear({
      ...emptyYear(2026),
      events: [
        { date: '2025-01-01', symbol: 'A', account: 'Broker', kind: 'ACQUIRE', quantity: 1, amountSek: 20_000 },
        { date: '2026-02-01', symbol: 'A', account: 'Broker', kind: 'DISPOSE', quantity: 1, amountSek: 10_000 },
        { date: '2025-01-01', symbol: 'B', account: 'Broker', kind: 'ACQUIRE', quantity: 1, amountSek: 1_000 },
        { date: '2026-02-01', symbol: 'B', account: 'Broker', kind: 'DISPOSE', quantity: 1, amountSek: 5_000 },
      ],
    });

    expect(result.depa.gains).toBeCloseTo(4_000, 6);
    expect(result.depa.losses).toBeCloseTo(10_000, 6);
    expect(result.depa.netResult).toBeCloseTo(-6_000, 6);
    expect(result.depa.deductibleResult).toBeCloseTo(-4_200, 6);
  });

  it('lets a depa loss reduce the tax on the ISK schablonintakt', () => {
    const withLoss = computeTaxYear({
      ...emptyYear(2024),
      isk: [isk('A', 1_000_000)],
      events: [
        { date: '2023-01-01', symbol: 'A', account: 'Broker', kind: 'ACQUIRE', quantity: 1, amountSek: 30_000 },
        { date: '2024-02-01', symbol: 'A', account: 'Broker', kind: 'DISPOSE', quantity: 1, amountSek: 20_000 },
      ],
    });
    const withoutLoss = computeTaxYear({ ...emptyYear(2024), isk: [isk('A', 1_000_000)] });

    expect(withoutLoss.tax).toBeCloseTo(10_860, 6); // 1 000 000 x 3.62 % x 30 %
    expect(withLoss.tax).toBeCloseTo(withoutLoss.tax - 7_000 * 0.3, 6);
  });

  it('turns a deficit into a reduction at 30 % up to 100 000 and 21 % above', () => {
    const result = computeTaxYear({
      ...emptyYear(2024),
      events: [
        { date: '2023-01-01', symbol: 'A', account: 'Broker', kind: 'ACQUIRE', quantity: 1, amountSek: 300_000 },
        { date: '2024-02-01', symbol: 'A', account: 'Broker', kind: 'DISPOSE', quantity: 1, amountSek: 100_000 },
      ],
    });

    // 200 000 loss -> 140 000 deficit -> 30 % of 100 000 + 21 % of 40 000.
    expect(result.kapitalOverskott).toBeCloseTo(-140_000, 6);
    expect(result.tax).toBe(0);
    expect(result.taxReduction).toBeCloseTo(38_400, 6);
  });

  it('taxes dividends and interest at 30 % alongside the schablonintakt', () => {
    const result = computeTaxYear({
      ...emptyYear(2024),
      dividendsSek: 5_000,
      interestSek: 1_000,
    });

    expect(result.tax).toBeCloseTo(1_800, 6);
  });
});
