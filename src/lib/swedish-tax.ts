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

export type Wrapper = 'ISK' | 'DEPA' | 'CRYPTO' | 'IGNORE';

/**
 * Statslaneräntan on 30 November, in percent, keyed by the year measured.
 * The value for year Y sets the ISK rate for tax year Y+1. Riksgalden
 * publishes it in early December - add one line per year. Starts at 2011,
 * the earliest year schablonRate ever looks up (ISK's first tax year is
 * 2012); depa does not use this table at all.
 */
export const SLR_NOV_30: Record<number, number> = {
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

/**
 * Schablonintakt pa fondandelar (42 kap. 43-44 SS IL): a holder of fund units
 * - Swedish or foreign, ETFs included - pays 0.4 % of their value at 1
 * January as capital income, on top of any gain realised on sale. It exists
 * only outside ISK and kapitalforsakring, since those wrappers are already
 * taxed on their whole balance under a separate schablon. Unlike the ISK
 * rate this one has not changed since it was introduced in 2012.
 */
const FUND_SCHABLON_RATE = 0.004;
const FUND_SCHABLON_FIRST_YEAR = 2012;

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

/** One line of K4 avsnitt A: a security's whole year, not one row per trade. */
export interface K4Summary {
  symbol: string;
  name?: string;
  quantity: number;
  forsaljningspris: number;
  omkostnadsbelopp: number;
  vinst: number;
  forlust: number;
}

/**
 * Skatteverket's K4 avsnitt A wants one line per security per year - sum
 * every disposal of it first, then round each amount to a whole krona
 * (helt krontal) before splitting the result into vinst or forlust, so the
 * row is internally consistent with what is printed on it.
 */
export function summarizeK4(rows: K4Row[]): K4Summary[] {
  const bySymbol = new Map<string, K4Summary>();

  for (const row of rows) {
    const existing = bySymbol.get(row.symbol) ?? {
      symbol: row.symbol,
      name: row.name,
      quantity: 0,
      forsaljningspris: 0,
      omkostnadsbelopp: 0,
      vinst: 0,
      forlust: 0,
    };
    existing.quantity += row.quantity;
    existing.forsaljningspris += row.forsaljningspris;
    existing.omkostnadsbelopp += row.omkostnadsbelopp;
    bySymbol.set(row.symbol, existing);
  }

  return [...bySymbol.values()]
    .map((s) => {
      const forsaljningspris = Math.round(s.forsaljningspris);
      const omkostnadsbelopp = Math.round(s.omkostnadsbelopp);
      const result = forsaljningspris - omkostnadsbelopp;
      return {
        ...s,
        forsaljningspris,
        omkostnadsbelopp,
        vinst: result > 0 ? result : 0,
        forlust: result < 0 ? -result : 0,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * One K4 line per disposal rather than per security. Skatteverket asks for
 * crypto that way - each avyttring on its own row - where avsnitt A is
 * summarised per security for the whole year.
 */
export function detailK4(rows: K4Row[]): K4Summary[] {
  return rows.map((row) => {
    const forsaljningspris = Math.round(row.forsaljningspris);
    const omkostnadsbelopp = Math.round(row.omkostnadsbelopp);
    const result = forsaljningspris - omkostnadsbelopp;
    return {
      symbol: row.symbol,
      name: row.name,
      quantity: row.quantity,
      forsaljningspris,
      omkostnadsbelopp,
      vinst: result > 0 ? result : 0,
      forlust: result < 0 ? -result : 0,
    };
  });
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
  /** One entry per fund/ETF symbol held in a depa on 1 January. */
  fundHoldings: FundHolding[];
  /**
   * All-time crypto acquisitions and disposals, pooled per coin across every
   * crypto account. Kept apart from `events` because avsnitt D has its own
   * pool, its own loss rule and no schablonmetoden.
   */
  cryptoEvents?: SecurityEvent[];
  /** Staking, earn and airdrop rewards received during the year, SEK. */
  cryptoRewardsSek?: number;
}

export interface FundHolding {
  symbol: string;
  name?: string;
  /** Human label for the detected type, e.g. "ETF" or "Mutual Fund". */
  typeLabel?: string;
  /** Held on 1 January of the tax year. */
  quantity: number;
  /** Price per unit in SEK, on or before 1 January. */
  priceSek: number;
}

export interface FundHoldingRow extends FundHolding {
  valueSek: number;
  /** 0.4 % of valueSek - see FUND_SCHABLON_RATE. */
  schablonintakt: number;
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
    /** One row per fund/ETF symbol, valued and taxed individually. */
    fundHoldings: FundHoldingRow[];
    /** Sum of fundHoldings[].valueSek. */
    fundHoldingsSek: number;
    /** Sum of fundHoldings[].schablonintakt. */
    fundSchablonintakt: number;
  };
  crypto: {
    /** One row per disposal - Skatteverket asks for crypto that way. */
    rows: K4Row[];
    gains: number;
    losses: number;
    /**
     * Gains count in full, losses only to 70 %, and - unlike avsnitt A - they
     * do not offset each other first: a +10 000 and a -10 000 in the same year
     * still leave 3 000 to be taxed.
     */
    deductibleResult: number;
    /** Rewards booked as capital income in the year they were received. */
    rewards: number;
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

export interface DisposalOptions {
  /** Default true. False for K4 avsnitt D, where the 20 % rule does not exist. */
  schablonmetoden?: boolean;
}

/**
 * Genomsnittsmetoden: omkostnadsbeloppet for a sale is the average cost of
 * every share of that security held, pooled across accounts. Needs the full
 * history, not just the year being reported, so `events` is all-time.
 */
export function computeDisposals(
  events: SecurityEvent[],
  year: number,
  options: DisposalOptions = {},
): { rows: K4Row[]; warnings: Warning[] } {
  // Schablonmetoden is a rule for marknadsnoterade delagarratter only. Crypto
  // is an "annan tillgang" (K4 avsnitt D), where it does not exist at all.
  const schablonAllowed = options.schablonmetoden !== false;
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

    const schablonOmkostnad = schablonAllowed ? e.amountSek * 0.2 : 0;
    let omkostnadsbelopp: number;
    let note: string | undefined;

    if (pos.quantity <= 0) {
      // Nothing on record to sell from - an acquisition is missing from the
      // imported history. Schablonmetoden is the defensible fallback where it
      // is allowed; where it is not, the whole proceeds are taxed and the gap
      // has to be closed by hand.
      omkostnadsbelopp = schablonOmkostnad;
      note = schablonAllowed
        ? 'no purchase on record, schablonmetoden (20 %) used'
        : 'no purchase on record, omkostnadsbelopp 0 - fill in by hand';
      warnings.push({
        category: 'Sales with no purchase on record',
        detail: schablonAllowed
          ? `${e.account}: ${e.symbol} sold ${e.date}, omkostnadsbelopp set to 20 % of the proceeds.`
          : `${e.account}: ${e.symbol} sold ${e.date}, and schablonmetoden does not apply to ` +
            `andra tillgangar - omkostnadsbelopp counted as 0, so the whole sale is taxed.`,
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

/**
 * Quantity held per symbol immediately before `cutoff` (YYYY-MM-DD), pooled
 * the same way as computeDisposals. Used to value fund holdings at 1 January
 * for the fund schablonintakt - only the quantity is needed there, not the
 * cost basis, so this replays the same event kinds without tracking cost.
 */
export function quantityBefore(events: SecurityEvent[], cutoff: string): Map<string, number> {
  const held = new Map<string, number>();
  const sorted = [...events].filter((e) => e.date < cutoff).sort((a, b) => a.date.localeCompare(b.date));

  for (const e of sorted) {
    const quantity = held.get(e.symbol) ?? 0;
    switch (e.kind) {
      case 'ACQUIRE':
        held.set(e.symbol, quantity + e.quantity);
        break;
      case 'DISPOSE':
      case 'REMOVE':
        held.set(e.symbol, Math.max(0, quantity - e.quantity));
        break;
      case 'SPLIT':
        held.set(e.symbol, quantity * e.quantity);
        break;
      case 'REBOOK':
        held.set(e.symbol, quantity - (e.replacedQuantity ?? 0) + e.quantity);
        break;
    }
  }

  return held;
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

  // Crypto is an "annan tillgang": its own average-cost pool, no schablonmetoden.
  const cryptoDisposals = computeDisposals(input.cryptoEvents ?? [], input.year, {
    schablonmetoden: false,
  });
  const cryptoGains = cryptoDisposals.rows
    .filter((r) => r.result > 0)
    .reduce((s, r) => s + r.result, 0);
  const cryptoLosses = cryptoDisposals.rows
    .filter((r) => r.result < 0)
    .reduce((s, r) => s - r.result, 0);
  // 48 kap. 20 SS IL: a loss on andra tillgangar is deductible to 70 %, and
  // there is no full quittning against gains in the same section first.
  const cryptoDeductible = cryptoGains - cryptoLosses * 0.7;
  const cryptoRewards = input.cryptoRewardsSek ?? 0;
  warnings.push(...cryptoDisposals.warnings);

  const fundRateApplies = input.year >= FUND_SCHABLON_FIRST_YEAR;
  const fundHoldings: FundHoldingRow[] = input.fundHoldings.map((f) => {
    const valueSek = f.quantity * f.priceSek;
    return { ...f, valueSek, schablonintakt: fundRateApplies ? valueSek * FUND_SCHABLON_RATE : 0 };
  });
  const fundHoldingsSek = fundHoldings.reduce((sum, f) => sum + f.valueSek, 0);
  const fundSchablonintakt = fundHoldings.reduce((sum, f) => sum + f.schablonintakt, 0);

  const kapitalOverskott =
    isk.schablonintakt +
    deductibleResult +
    input.dividendsSek +
    input.interestSek +
    fundSchablonintakt +
    cryptoDeductible +
    cryptoRewards;

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
      fundHoldings,
      fundHoldingsSek,
      fundSchablonintakt,
    },
    crypto: {
      rows: cryptoDisposals.rows,
      gains: cryptoGains,
      losses: cryptoLosses,
      deductibleResult: cryptoDeductible,
      rewards: cryptoRewards,
    },
    kapitalOverskott,
    tax,
    taxReduction,
    warnings,
  };
}
