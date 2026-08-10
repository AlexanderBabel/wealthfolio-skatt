/**
 * Swedish capital income tax, for two account wrappers:
 *
 *   ISK  - investeringssparkonto. Taxed on a notional yield (schablonintakt)
 *          derived from the account value, not on what it actually earned.
 *   Depa - ordinary taxable account. Taxed on realised gains, dividends and
 *          interest.
 *
 * Everything in this file is pure: amounts in SEK, no I/O, no host API. The
 * glue that turns Wealthfolio data into these inputs lives in
 * `hooks/use-tax-year.ts`, and the numbers are estimates - see README.
 */

export type Wrapper = 'ISK' | 'DEPA' | 'IGNORE';

/**
 * Statslaneräntan on 30 November, in percent, keyed by the year measured.
 * The value for year Y sets the ISK rate for tax year Y+1. Riksgalden
 * publishes it in early December - add one line per year.
 */
export const SLR_NOV_30: Record<number, number> = {
  2000: 5.06,
  2001: 4.94,
  2002: 4.85,
  2003: 4.71,
  2004: 3.95,
  2005: 3.26,
  2006: 3.54,
  2007: 4.16,
  2008: 2.89,
  2009: 3.2,
  2010: 2.84,
  2011: 1.65,
  2012: 1.49,
  2013: 2.09,
  2014: 0.9,
  2015: 0.65,
  2016: 0.27,
  2017: 0.49,
  2018: 0.51,
  2019: -0.09,
  2020: -0.1,
  2021: 0.23,
  2022: 1.94,
  2023: 2.62,
  2024: 2.06,
  2025: 2.55,
};

/** ISK exists from 1 January 2012; earlier years have no schablonintakt. */
const ISK_FIRST_YEAR = 2012;

/** Fribelopp: kapitalunderlaget is reduced by this before the rate applies. */
const FRIBELOPP: Record<number, number> = {
  2025: 150_000,
  2026: 300_000,
};

/**
 * The rate applied to the kapitalunderlag. The rule has changed twice since
 * ISK was introduced, so an old year is not just an old number:
 *
 *   2012-2015  statslaneräntan as it stands, no addition and no floor
 *   2016-2017  plus 0.75 percentage points, never below 1.25 %
 *   2018-      plus 1.00 percentage points, never below 1.25 %
 */
export function schablonRate(year: number): number | null {
  const slr = SLR_NOV_30[year - 1];
  if (slr === undefined || year < ISK_FIRST_YEAR) return null;
  if (year <= 2015) return slr / 100;
  return Math.max(slr + (year <= 2017 ? 0.75 : 1), 1.25) / 100;
}

/**
 * One allowance per person, shared across every ISK (and kapitalforsakring,
 * which this addon does not model). Introduced in 2025.
 */
export function fribelopp(year: number): number | null {
  if (year < 2025) return 0;
  return FRIBELOPP[year] ?? null;
}

export interface IskAccount {
  accountId: string;
  name: string;
  /** Value in SEK at the start of Q1..Q4. null when no valuation is known. */
  quarterValues: (number | null)[];
  /** Indices of quarters that have not started yet (filled with today's value). */
  projectedQuarters: number[];
  /** Insattningar during the year, SEK. Withdrawals do not reduce this. */
  deposits: number;
}

export interface IskAccountResult extends IskAccount {
  kapitalunderlag: number;
  fribeloppShare: number;
  taxableUnderlag: number;
  schablonintakt: number;
  /** Quarters with no valuation, counted as 0 - makes the year an estimate. */
  unknownQuarters: number[];
}

/**
 * A warning carries its category so the page can group a hundred of them into
 * a handful of lines instead of an unreadable list.
 */
export interface Warning {
  category: string;
  detail: string;
}

export interface SecurityEvent {
  /** YYYY-MM-DD */
  date: string;
  symbol: string;
  name?: string;
  account: string;
  /**
   * REMOVE takes shares out of the pool without a taxable disposal. REBOOK is a
   * split or a broker re-issue booked as a pair of transfers: the share count
   * changes, the cost does not. SPLIT is the same event booked as a ratio.
   */
  kind: 'ACQUIRE' | 'DISPOSE' | 'REMOVE' | 'REBOOK' | 'SPLIT';
  /** SPLIT: the ratio - 4 for a 4:1 split, 1/12 for a 1:12 reverse split. */
  quantity: number;
  /** REBOOK: how many shares the new `quantity` replaces. */
  replacedQuantity?: number;
  /**
   * ACQUIRE: everything paid, courtage included (adds to omkostnadsbelopp).
   * DISPOSE: proceeds after courtage (forsaljningspris, 44 kap. 13 § IL).
   * REMOVE, REBOOK and SPLIT: ignored.
   */
  amountSek: number;
}

export interface K4Row {
  date: string;
  symbol: string;
  name?: string;
  account: string;
  quantity: number;
  forsaljningspris: number;
  omkostnadsbelopp: number;
  result: number;
  /** 20 % of the proceeds - allowed instead of average cost for listed shares. */
  schablonOmkostnad: number;
  schablonBetter: boolean;
  note?: string;
}

export interface TaxYearInput {
  year: number;
  isk: IskAccount[];
  /** All-time disposals across every depa account, so average cost is right. */
  events: SecurityEvent[];
  dividendsSek: number;
  interestSek: number;
  /** Withholding tax seen on ISK dividends. Informational only. */
  iskWithholdingSek: number;
  /** Depa fees. Forvaltningsutgifter, not deductible since 2016. */
  depaFeesSek: number;
}

export interface TaxYearResult {
  year: number;
  rate: number;
  /** False when no statslaneranta is on record - the ISK half reads 0. */
  rateAvailable: boolean;
  fribelopp: number;
  isk: {
    accounts: IskAccountResult[];
    kapitalunderlag: number;
    /** The part of the fribelopp actually used - never more than the underlag. */
    fribeloppApplied: number;
    taxableUnderlag: number;
    schablonintakt: number;
    withholding: number;
  };
  depa: {
    rows: K4Row[];
    gains: number;
    losses: number;
    /** Gains and losses on listed delagarratter offset each other in full. */
    netResult: number;
    /** A residual net loss counts at 70 % against other capital income. */
    deductibleResult: number;
    dividends: number;
    interest: number;
    fees: number;
  };
  kapitalOverskott: number;
  /** Tax to pay, SEK. Zero when the year is a deficit. */
  tax: number;
  /** Skattereduktion, SEK. Zero when the year is a surplus. */
  taxReduction: number;
  warnings: Warning[];
}

/** Relative tolerance on share counts, to absorb accumulated float error. */
const QUANTITY_EPSILON = 1e-6;

function computeIsk(accounts: IskAccount[], rate: number, allowance: number) {
  const withUnderlag = accounts.map((a) => {
    const quarters = a.quarterValues.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    return {
      ...a,
      kapitalunderlag: (quarters + a.deposits) / 4,
      unknownQuarters: a.quarterValues.flatMap((v, i) => (v === null ? [i] : [])),
    };
  });

  const total = withUnderlag.reduce((sum, a) => sum + a.kapitalunderlag, 0);
  // The allowance can never exceed the underlag, so shares stay non-negative
  // and sum to exactly max(0, total - allowance).
  const applied = Math.min(allowance, total);

  const results: IskAccountResult[] = withUnderlag.map((a) => {
    const fribeloppShare = total > 0 ? (a.kapitalunderlag / total) * applied : 0;
    const taxableUnderlag = a.kapitalunderlag - fribeloppShare;
    return {
      ...a,
      fribeloppShare,
      taxableUnderlag,
      schablonintakt: taxableUnderlag * rate,
    };
  });

  return {
    accounts: results,
    kapitalunderlag: total,
    fribeloppApplied: applied,
    taxableUnderlag: total - applied,
    schablonintakt: results.reduce((sum, a) => sum + a.schablonintakt, 0),
  };
}

/**
 * Genomsnittsmetoden: omkostnadsbeloppet for a sale is the average cost of
 * every share of that security held, pooled across accounts. Needs the full
 * history, not just the year being reported, so `events` is all-time.
 */
export function computeDisposals(
  events: SecurityEvent[],
  year: number,
): { rows: K4Row[]; warnings: Warning[] } {
  const held = new Map<string, { quantity: number; cost: number }>();
  const rows: K4Row[] = [];
  const warnings: Warning[] = [];

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

  for (const e of sorted) {
    const pos = held.get(e.symbol) ?? { quantity: 0, cost: 0 };

    if (e.kind === 'ACQUIRE') {
      held.set(e.symbol, { quantity: pos.quantity + e.quantity, cost: pos.cost + e.amountSek });
      continue;
    }

    if (e.kind === 'REMOVE') {
      const quantity = Math.min(e.quantity, pos.quantity);
      const share = pos.quantity > 0 ? (pos.cost / pos.quantity) * quantity : 0;
      held.set(e.symbol, { quantity: pos.quantity - quantity, cost: pos.cost - share });
      continue;
    }

    if (e.kind === 'SPLIT') {
      // More shares (or fewer) for the same money: only the count changes.
      held.set(e.symbol, { quantity: pos.quantity * e.quantity, cost: pos.cost });
      continue;
    }

    if (e.kind === 'REBOOK') {
      // Whatever came out is replaced by what went in, at the same cost.
      held.set(e.symbol, {
        quantity: pos.quantity - (e.replacedQuantity ?? 0) + e.quantity,
        cost: pos.cost,
      });
      continue;
    }

    const schablonOmkostnad = e.amountSek * 0.2;
    let omkostnadsbelopp: number;
    let note: string | undefined;

    if (pos.quantity <= 0) {
      // Nothing on record to sell from - an acquisition is missing from the
      // imported history. Schablonmetoden is the defensible fallback.
      omkostnadsbelopp = schablonOmkostnad;
      note = 'no purchase on record, schablonmetoden (20 %) used';
      warnings.push({
        category: 'Sales with no purchase on record',
        detail: `${e.account}: ${e.symbol} sold ${e.date}, omkostnadsbelopp set to 20 % of the proceeds.`,
      });
    } else {
      const quantity = Math.min(e.quantity, pos.quantity);
      // Share counts accumulate float error over years of fractional trades, so
      // "2 against 1.9999999999999998" is the same holding, not an overdraft.
      const overdraft = e.quantity - pos.quantity;
      if (overdraft > Math.max(QUANTITY_EPSILON, pos.quantity * QUANTITY_EPSILON)) {
        note = 'sold more than the recorded holding';
        warnings.push({
          category: 'Sales larger than the recorded holding',
          detail:
            `${e.account}: ${e.symbol} sold ${e.date}, ${e.quantity} sold against ` +
            `${pos.quantity} on record.`,
        });
      }
      omkostnadsbelopp = (pos.cost / pos.quantity) * quantity;
      held.set(e.symbol, {
        quantity: pos.quantity - quantity,
        cost: pos.cost - omkostnadsbelopp,
      });
    }

    if (e.date.slice(0, 4) === String(year)) {
      rows.push({
        date: e.date,
        symbol: e.symbol,
        name: e.name,
        account: e.account,
        quantity: e.quantity,
        forsaljningspris: e.amountSek,
        omkostnadsbelopp,
        result: e.amountSek - omkostnadsbelopp,
        schablonOmkostnad,
        schablonBetter: schablonOmkostnad > omkostnadsbelopp,
        note,
      });
    }
  }

  return { rows, warnings };
}

export function computeTaxYear(input: TaxYearInput): TaxYearResult {
  const configuredRate = schablonRate(input.year);
  const configuredAllowance = fribelopp(input.year);
  const rateAvailable = configuredRate !== null && configuredAllowance !== null;

  const rate = configuredRate ?? 0;
  const allowance = configuredAllowance ?? 0;

  const isk = computeIsk(input.isk, rate, allowance);
  const { rows, warnings } = computeDisposals(input.events, input.year);

  // A year without a published rate is still a perfectly good depa year, so it
  // is reported rather than refused - only the ISK half goes missing.
  if (!rateAvailable && input.isk.length > 0) {
    warnings.push({
      category: 'No ISK rate for this year',
      detail:
        input.year < ISK_FIRST_YEAR
          ? `ISK did not exist in ${input.year}, so no schablonintakt is calculated.`
          : `No statslaneranta on record for 30 November ${input.year - 1}. Add it to ` +
            `SLR_NOV_30 in src/lib/swedish-tax.ts; the ISK figures are 0 until then.`,
    });
  }

  const gains = rows.filter((r) => r.result > 0).reduce((s, r) => s + r.result, 0);
  const losses = rows.filter((r) => r.result < 0).reduce((s, r) => s - r.result, 0);
  const netResult = gains - losses;
  // Within listed delagarratter a loss offsets a gain in full; only what is
  // left over is quoted down to 70 % before it meets other capital income.
  const deductibleResult = netResult >= 0 ? netResult : netResult * 0.7;

  const kapitalOverskott =
    isk.schablonintakt + deductibleResult + input.dividendsSek + input.interestSek;

  let tax = 0;
  let taxReduction = 0;
  if (kapitalOverskott >= 0) {
    tax = kapitalOverskott * 0.3;
  } else {
    const underskott = -kapitalOverskott;
    taxReduction = 0.3 * Math.min(underskott, 100_000) + 0.21 * Math.max(0, underskott - 100_000);
  }

  // Quarters still in the future are not warned about: the table marks them and
  // the page already says the year is running.
  for (const a of isk.accounts) {
    if (a.unknownQuarters.length > 0) {
      warnings.push({
        category: 'Quarter starts with no valuation',
        detail: `${a.name}: ${a.unknownQuarters.length} quarter start(s) counted as 0.`,
      });
    }
  }

  return {
    year: input.year,
    rate,
    rateAvailable,
    fribelopp: allowance,
    isk: { ...isk, withholding: input.iskWithholdingSek },
    depa: {
      rows,
      gains,
      losses,
      netResult,
      deductibleResult,
      dividends: input.dividendsSek,
      interest: input.interestSek,
      fees: input.depaFeesSek,
    },
    kapitalOverskott,
    tax,
    taxReduction,
    warnings,
  };
}
