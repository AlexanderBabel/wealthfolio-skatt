import { describe, expect, it } from 'vitest';
import {
  computeDisposals,
  computeTaxYear,
  detailK4,
  fribelopp,
  quantityBefore,
  schablonRate,
  summarizeK4,
  type IskAccount,
  type K4Row,
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
  fundHoldings: [],
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

  it('follows the rule in force that year, not just the rate', () => {
    // Before 2016 the rate was the state loan rate itself, with no addition
    // and no floor: 2015 was taxed at 0.90 %, giving the well-known 0.27 %.
    expect(schablonRate(2015)).toBeCloseTo(0.009, 10);
    expect(schablonRate(2015)! * 0.3).toBeCloseTo(0.0027, 10);
    // 2016 and 2017 added 0.75 points, so 2017 landed on the floor: 0.375 %.
    expect(schablonRate(2016)).toBeCloseTo(0.014, 10);
    expect(schablonRate(2017)).toBeCloseTo(0.0125, 10);
    expect(schablonRate(2017)! * 0.3).toBeCloseTo(0.00375, 10);
    // 2018 moved to a full point: 0.49 + 1 = 1.49 %, giving 0.447 %.
    expect(schablonRate(2018)).toBeCloseTo(0.0149, 10);
  });

  it('has no rate before ISK existed', () => {
    expect(schablonRate(2012)).toBeCloseTo(0.0165, 10);
    expect(schablonRate(2011)).toBeNull();
  });

  it('is unknown for a year whose rate has not been published yet', () => {
    expect(schablonRate(2099)).toBeNull();
    expect(fribelopp(2099)).toBeNull();
  });

  it('still reports a depa year that has no ISK rate', () => {
    const result = computeTaxYear({
      ...emptyYear(2008),
      events: [
        { date: '2007-01-01', symbol: 'A', account: 'Broker', kind: 'ACQUIRE', quantity: 1, amountSek: 1_000 },
        { date: '2008-02-01', symbol: 'A', account: 'Broker', kind: 'DISPOSE', quantity: 1, amountSek: 3_000 },
      ],
    });

    expect(result.rateAvailable).toBe(false);
    expect(result.depa.gains).toBeCloseTo(2_000, 6);
    expect(result.tax).toBeCloseTo(600, 6);
    // No ISK account was marked, so the missing rate is not worth mentioning.
    expect(result.warnings).toHaveLength(0);
  });

  it('says so when an ISK account has no rate for its year', () => {
    const result = computeTaxYear({ ...emptyYear(2011), isk: [isk('A', 100_000)] });

    expect(result.isk.schablonintakt).toBe(0);
    expect(result.warnings[0].category).toBe('No ISK rate for this year');
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

  it('carries the cost basis through a share split', () => {
    // 0.044 shares at 1766 leave and 0.886 at 88 arrive: a 20:1 split, booked
    // as a transfer out and a transfer in of the same security.
    const { rows } = computeDisposals(
      [
        buy('2021-01-10', 0.04429131, 1000),
        {
          ...buy('2022-07-18', 0.8858262, 0),
          kind: 'REBOOK',
          replacedQuantity: 0.04429131,
        },
        sell('2026-03-01', 0.8858262, 1500),
      ],
      2026,
    );

    expect(rows[0].omkostnadsbelopp).toBeCloseTo(1000, 6);
    expect(rows[0].result).toBeCloseTo(500, 6);
  });

  it('applies a split booked as a ratio', () => {
    // The shape of the reported bug: 16.3 shares bought, a 4:1 split, then
    // 59.1 sold. Without the split that reads as a sale of shares never bought.
    const { rows, warnings } = computeDisposals(
      [
        buy('2020-01-10', 16.3044962, 10000),
        { ...buy('2020-08-31', 4, 0), kind: 'SPLIT' },
        sell('2020-09-04', 59.1364036, 30000),
      ],
      2020,
    );

    expect(warnings).toHaveLength(0);
    // 59.14 of the 65.22 shares now held, so that share of the 10 000 kr paid.
    expect(rows[0].omkostnadsbelopp).toBeCloseTo(10000 * (59.1364036 / 65.2179848), 6);
  });

  it('applies a reverse split the same way', () => {
    const { rows } = computeDisposals(
      [
        buy('2022-01-10', 120, 6000),
        { ...buy('2022-12-13', 1 / 12, 0), kind: 'SPLIT' },
        sell('2026-01-10', 10, 4000),
      ],
      2026,
    );

    expect(rows[0].omkostnadsbelopp).toBeCloseTo(6000, 6);
    expect(rows[0].result).toBeCloseTo(-2000, 6);
  });

  it('does not call a rounded-off share count an overdraft', () => {
    const { rows, warnings } = computeDisposals(
      [buy('2025-01-10', 1.9999999999999998, 1000), sell('2026-01-10', 2, 1200)],
      2026,
    );

    expect(warnings).toHaveLength(0);
    expect(rows[0].omkostnadsbelopp).toBeCloseTo(1000, 6);
  });

  it('still reports a genuine overdraft', () => {
    const { warnings } = computeDisposals(
      [buy('2025-01-10', 2, 1000), sell('2026-01-10', 5, 1200)],
      2026,
    );

    expect(warnings[0].category).toBe('Sales larger than the recorded holding');
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

describe('fund schablonintakt', () => {
  const holding = (symbol: string, quantity: number, priceSek: number) => ({
    symbol,
    quantity,
    priceSek,
  });

  it('taxes 0.4 % of the value the caller supplies, at 30 %', () => {
    const result = computeTaxYear({
      ...emptyYear(2024),
      fundHoldings: [holding('AAA', 1000, 100)],
    });

    expect(result.depa.fundHoldingsSek).toBe(100_000);
    expect(result.depa.fundSchablonintakt).toBeCloseTo(400, 6);
    expect(result.tax).toBeCloseTo(120, 6);
  });

  it('values and taxes each fund on its own line', () => {
    const result = computeTaxYear({
      ...emptyYear(2024),
      fundHoldings: [holding('AAA', 1000, 100), holding('BBB', 10, 5000)],
    });

    expect(result.depa.fundHoldings).toHaveLength(2);
    expect(result.depa.fundHoldings[0].valueSek).toBe(100_000);
    expect(result.depa.fundHoldings[0].schablonintakt).toBeCloseTo(400, 6);
    expect(result.depa.fundHoldings[1].valueSek).toBe(50_000);
    expect(result.depa.fundHoldings[1].schablonintakt).toBeCloseTo(200, 6);
    expect(result.depa.fundSchablonintakt).toBeCloseTo(600, 6);
  });

  it('does not apply before the rule existed in 2012', () => {
    const result = computeTaxYear({
      ...emptyYear(2011),
      fundHoldings: [holding('AAA', 1000, 100)],
    });
    expect(result.depa.fundSchablonintakt).toBe(0);
  });
});

describe('summarizeK4', () => {
  const row = (symbol: string, forsaljningspris: number, omkostnadsbelopp: number): K4Row => ({
    date: '2026-01-01',
    symbol,
    account: 'Broker',
    quantity: 1,
    forsaljningspris,
    omkostnadsbelopp,
    result: forsaljningspris - omkostnadsbelopp,
    schablonOmkostnad: 0,
    schablonBetter: false,
  });

  it('sums every disposal of a security into one line', () => {
    const rows = summarizeK4([row('AAA', 1000, 600), row('AAA', 500, 300)]);

    expect(rows).toHaveLength(1);
    expect(rows[0].forsaljningspris).toBe(1500);
    expect(rows[0].omkostnadsbelopp).toBe(900);
    expect(rows[0].vinst).toBe(600);
    expect(rows[0].forlust).toBe(0);
  });

  it('keeps different securities on separate lines, sorted by symbol', () => {
    const rows = summarizeK4([row('BBB', 100, 200), row('AAA', 100, 50)]);

    expect(rows.map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(rows[1].vinst).toBe(0);
    expect(rows[1].forlust).toBe(100);
  });

  it('rounds to whole kronor before splitting into vinst or forlust', () => {
    const rows = summarizeK4([row('AAA', 100.6, 100.2)]);
    // 101 - 100 = 1, not the unrounded 0.4 - the row must read consistently.
    expect(rows[0].forsaljningspris).toBe(101);
    expect(rows[0].omkostnadsbelopp).toBe(100);
    expect(rows[0].vinst).toBe(1);
  });
});

describe('quantityBefore', () => {
  const buy = (date: string, symbol: string, quantity: number): SecurityEvent => ({
    date,
    symbol,
    account: 'Broker',
    kind: 'ACQUIRE',
    quantity,
    amountSek: 0,
  });

  it('pools acquisitions across accounts up to the cutoff', () => {
    const held = quantityBefore(
      [buy('2024-01-10', 'AAA', 10), { ...buy('2024-06-10', 'AAA', 5), account: 'Other' }],
      '2025-01-01',
    );
    expect(held.get('AAA')).toBe(15);
  });

  it('excludes events on or after the cutoff', () => {
    const held = quantityBefore([buy('2025-01-01', 'AAA', 10)], '2025-01-01');
    expect(held.get('AAA')).toBeUndefined();
  });

  it('applies disposals, splits and rebooks the same as computeDisposals', () => {
    const held = quantityBefore(
      [
        buy('2024-01-01', 'AAA', 100),
        { ...buy('2024-03-01', 'AAA', 4), kind: 'SPLIT' },
        { date: '2024-06-01', symbol: 'AAA', account: 'Broker', kind: 'DISPOSE', quantity: 150, amountSek: 0 },
        {
          date: '2024-09-01',
          symbol: 'AAA',
          account: 'Broker',
          kind: 'REBOOK',
          quantity: 500,
          replacedQuantity: 250,
          amountSek: 0,
        },
      ],
      '2025-01-01',
    );
    // 100 x 4 = 400, minus 150 disposed = 250, rebooked into 500.
    expect(held.get('AAA')).toBe(500);
  });
});

describe('crypto (K4 avsnitt D)', () => {
  const coin = (
    symbol: string,
    date: string,
    kind: SecurityEvent['kind'],
    quantity: number,
    amountSek: number,
  ): SecurityEvent => ({ date, symbol, account: 'Wallet', kind, quantity, amountSek });

  it('does not let a loss offset a gain in full - each loss counts at 70 %', () => {
    const result = computeTaxYear({
      ...emptyYear(2026),
      cryptoEvents: [
        coin('BTC', '2025-01-01', 'ACQUIRE', 1, 100_000),
        coin('BTC', '2026-02-01', 'DISPOSE', 1, 110_000), // +10 000
        coin('ETH', '2025-01-01', 'ACQUIRE', 1, 100_000),
        coin('ETH', '2026-02-01', 'DISPOSE', 1, 90_000), // -10 000
      ],
    });

    expect(result.crypto.gains).toBeCloseTo(10_000, 6);
    expect(result.crypto.losses).toBeCloseTo(10_000, 6);
    // Shares in avsnitt A would net to exactly 0 here. Avsnitt D does not.
    expect(result.crypto.deductibleResult).toBeCloseTo(3_000, 6);
    expect(result.tax).toBeCloseTo(900, 6);
  });

  it('gives back 21 % of a pure loss year as skattereduktion', () => {
    const result = computeTaxYear({
      ...emptyYear(2026),
      cryptoEvents: [
        coin('BTC', '2025-01-01', 'ACQUIRE', 1, 10_000),
        coin('BTC', '2026-02-01', 'DISPOSE', 1, 9_000),
      ],
    });

    expect(result.crypto.deductibleResult).toBeCloseTo(-700, 6);
    expect(result.tax).toBe(0);
    expect(result.taxReduction).toBeCloseTo(210, 6); // 700 x 30 %
  });

  it('never falls back on schablonmetoden, which does not exist for andra tillgangar', () => {
    const result = computeTaxYear({
      ...emptyYear(2026),
      cryptoEvents: [coin('BTC', '2026-02-01', 'DISPOSE', 1, 50_000)],
    });

    // A share with no purchase on record would get 20 % of the proceeds.
    expect(result.crypto.rows[0].omkostnadsbelopp).toBe(0);
    expect(result.crypto.rows[0].schablonOmkostnad).toBe(0);
    expect(result.crypto.rows[0].schablonBetter).toBe(false);
    expect(result.crypto.gains).toBeCloseTo(50_000, 6);
    expect(result.warnings.some((w) => w.category === 'Sales with no purchase on record')).toBe(true);
  });

  it('taxes rewards on receipt and keeps the crypto pool apart from the depa pool', () => {
    const result = computeTaxYear({
      ...emptyYear(2026),
      cryptoRewardsSek: 5_000,
      // Same symbol in both pools, bought at wildly different prices: if they
      // pooled together the omkostnadsbelopp below would not be 100.
      events: [
        coin('X', '2025-01-01', 'ACQUIRE', 1, 900),
        coin('X', '2026-06-01', 'DISPOSE', 1, 900),
      ],
      cryptoEvents: [
        coin('X', '2025-01-01', 'ACQUIRE', 1, 100),
        coin('X', '2026-06-01', 'DISPOSE', 1, 300),
      ],
    });

    expect(result.crypto.rows[0].omkostnadsbelopp).toBeCloseTo(100, 6);
    expect(result.crypto.rewards).toBeCloseTo(5_000, 6);
    expect(result.kapitalOverskott).toBeCloseTo(5_200, 6); // 5 000 rewards + 200 gain
  });

  it('summarises per disposal or per coin on request', () => {
    const { rows } = computeDisposals(
      [
        coin('BTC', '2025-01-01', 'ACQUIRE', 2, 200),
        coin('BTC', '2026-02-01', 'DISPOSE', 1, 150),
        coin('BTC', '2026-03-01', 'DISPOSE', 1, 50),
      ],
      2026,
      { schablonmetoden: false },
    );

    expect(detailK4(rows)).toHaveLength(2);
    expect(detailK4(rows).map((r) => r.vinst)).toEqual([50, 0]);
    expect(detailK4(rows).map((r) => r.forlust)).toEqual([0, 50]);
    // Per coin the two disposals wash out into a single break-even row.
    expect(summarizeK4(rows)).toHaveLength(1);
    expect(summarizeK4(rows)[0]).toMatchObject({ forsaljningspris: 200, vinst: 0, forlust: 0 });
  });
});

describe('income rows', () => {
  const payment = (date: string, kind: string, amountSek: number) => ({
    date,
    symbol: 'AAA',
    account: 'Broker',
    kind,
    amountSek,
  });

  it('lists dividends and interest newest first, without touching the totals', () => {
    const result = computeTaxYear({
      ...emptyYear(2026),
      dividendsSek: 300,
      interestSek: 50,
      incomeRows: [
        payment('2026-01-10', 'Dividend', 100),
        payment('2026-09-02', 'Dividend', 200),
        payment('2026-05-05', 'Interest', 50),
      ],
    });

    expect(result.depa.incomeRows.map((r) => r.date)).toEqual([
      '2026-09-02',
      '2026-05-05',
      '2026-01-10',
    ]);
    // The rows are for display; the taxable figure still comes from the sums.
    expect(result.depa.dividends).toBe(300);
    expect(result.depa.interest).toBe(50);
    expect(result.kapitalOverskott).toBeCloseTo(350, 6);
  });

  it('lists crypto rewards the same way', () => {
    const result = computeTaxYear({
      ...emptyYear(2026),
      cryptoRewardsSek: 90,
      cryptoRewardRows: [payment('2026-03-01', 'Reward', 40), payment('2026-08-01', 'Reward', 50)],
    });

    expect(result.crypto.rewardRows.map((r) => r.date)).toEqual(['2026-08-01', '2026-03-01']);
    expect(result.crypto.rewards).toBe(90);
  });

  it('is an empty list rather than undefined when nothing was paid', () => {
    const result = computeTaxYear(emptyYear(2026));
    expect(result.depa.incomeRows).toEqual([]);
    expect(result.crypto.rewardRows).toEqual([]);
  });
});
