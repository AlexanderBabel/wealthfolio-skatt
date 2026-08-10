# Skatt — Swedish tax overview for Wealthfolio

A Wealthfolio addon that estimates Swedish capital income tax per calendar year, for both
account wrappers a private investor normally holds:

- **ISK** (investeringssparkonto) — taxed on a notional yield (schablonintäkt) derived from
  the account value, whatever the account actually earned.
- **Depå** — an ordinary taxable account, taxed on realised gains, dividends and interest.

It produces the number you would put in a declaration, and shows the working. It does **not**
produce the declaration: see [Not implemented](#not-implemented).

> **This is an estimate.** It reads the data you imported into Wealthfolio, which is not the
> same thing as your brokers' tax statements. Reconcile before you file.

## What it computes

### ISK

```
kapitalunderlag  = (value 1 Jan + 1 Apr + 1 Jul + 1 Oct + insättningar during the year) / 4
schablonintäkt   = (kapitalunderlag − fribelopp) × rate
tax              = 30 % of the capital surplus
```

The rate follows the rule in force that year, which has changed twice since ISK was
introduced in 2012 — an old year is not just an old number:

| Tax year | Rate |
|---|---|
| 2012–2015 | statslåneräntan on 30 Nov, as it stands |
| 2016–2017 | plus 0.75 percentage points, never below 1.25 % |
| 2018– | plus 1.00 percentage points, never below 1.25 % |

`SLR_NOV_30` only feeds the ISK schablonintäkt; depå years are unaffected by it and reach
back as far as the imported activity does.

- Withdrawals never reduce the kapitalunderlag.
- The fribelopp (150 000 kr in 2025, 300 000 kr from 2026) is one allowance per person. It is
  applied to the combined kapitalunderlag of every account marked ISK, and shown split across
  them in proportion.
- Moving securities between two of your **own** ISKs is not an insättning. The addon detects
  this by matching a `TRANSFER_IN` against a `TRANSFER_OUT` of the same security, quantity and
  date in another account you have marked ISK.
- A currency conversion inside one account is usually imported as a withdrawal in one currency
  and a deposit in another on the same day. That deposit is not an insättning either, and is
  excluded — with a warning, so you can check it was really a conversion.

### Depå

Omkostnadsbeloppet uses **genomsnittsmetoden**: the average cost of every share of that
security held, pooled across all accounts marked Depå, recomputed from the full history rather
than the reported year alone. Courtage is folded in — it raises the omkostnadsbelopp on a buy
and lowers the försäljningspris on a sale (44 kap. 13 § IL) rather than being deducted
separately.

Sales where **schablonmetoden** (20 % of the proceeds) would give a lower gain are flagged, but
the figures always use the average cost. Where no purchase is on record at all, schablonmetoden
is used as the fallback and the row is marked.

A transfer is not a sale. Moving securities **out of a depå and into an ISK** is a disposal at
market value, because the shares leave the taxable wrapper — that, and only that. Moving them
to another depå changes nothing, since the average cost is pooled across depå accounts anyway.
A transfer whose other leg is missing takes the shares off the holding without a taxable event
and says so. The two legs are matched on security and quantity within seven days, because
settlement rarely puts them on the same date.

A **split or a broker re-issue** shows up in the same shape — a transfer out and a transfer in
of the same security in the *same* account, days apart, with a different share count on each
side. That is not a disposal either: the cost basis carries over untouched and only the number
of shares changes.

Brokers that book a split as its own `SPLIT` row instead are handled too: the ratio multiplies
the share count and leaves the omkostnadsbelopp alone, which is also what a reverse split does,
with a ratio below one.

### Putting them together

Gains and losses on listed delägarrätter offset each other in full. A residual net loss counts
at 70 % against other capital income — including the ISK schablonintäkt, which is why a bad
year in the depå lowers the tax on the ISK. A surplus is taxed at 30 %; a deficit becomes a tax
reduction of 30 % up to 100 000 kr and 21 % above.

## Setup

1. Install the addon, open **Skatt** in the sidebar, go to the **Accounts** tab.
2. Mark each account as ISK, Depå, or leave it as "Not taxed here".

Nothing else is configured. Your base currency must be SEK; the addon says so loudly if it
isn't.

## Every December: one number

The schablonintäkt rate follows statslåneräntan on 30 November, which Riksgälden publishes in
early December. Add one line to `SLR_NOV_30` in [`src/lib/swedish-tax.ts`](src/lib/swedish-tax.ts):

```ts
export const SLR_NOV_30: Record<number, number> = {
  // ...
  2025: 2.55,   // sets the rate for tax year 2026: 2.55 + 1 = 3.55 %
};
```

Until that line exists the ISK figures read 0 and say why; the depå side of the year is
unaffected. The value is not fetched: Riksbank's API publishes the 5-year government bond yield, which is
the input Riksgälden averages, **not** statslåneräntan itself — close enough to look right and
wrong enough to matter.

## Partial and incomplete years

- **The current year** is computed from the quarters that have started; the ones that have not
  are filled with the latest known value and marked `*`. The number will move.
- **A quarter with no valuation** is counted as 0, and listed as a warning. If the account had
  no activity at all before that date it was genuinely empty, and no warning is raised.

## Not implemented

Contributions welcome; these are all deliberate omissions rather than oversights.

| Missing | Why, and what it would take |
|---|---|
| **K4 / SRU export** | The rows on the Depå tab are already a K4 avsnitt A in all but name — date, security, antal, försäljningspris, omkostnadsbelopp, resultat. Generating `BLANKETTER.SRU` needs a personnummer, the year's blankett identifier (Skatteverket publishes it around new year), and whole-krona rounding applied identically to the form and the totals. |
| **Kapitalförsäkring** | Different formula: value on 1 Jan plus premiums paid, those in the second half counted at half. It shares the fribelopp with ISK, so adding it changes the ISK numbers too. |
| **Gross dividends and foreign withholding tax** | Wealthfolio records what was credited to the account. If your import books dividends net of withholding, the addon cannot recover the gross figure or the tax paid, and INK1 7.2 wants gross. Withholding recorded as a separate `TAX` activity inside an ISK is shown as an informational line only. |
| **Avräkning av utländsk skatt** | The real spärrbelopp prorates against income the addon cannot see. |
| **Avsnitt C (currency gains)** | Disposing of a foreign currency balance is itself a taxable event. Not modelled. |
| **Riksbank fixings** | Amounts are converted with Wealthfolio's own daily rate history for the date of the transaction, not the Riksbank fixing a declaration would use. Small, but it is a difference. |

## Development

```bash
pnpm install
pnpm dev:server     # live reload against a running Wealthfolio
pnpm test           # the calculation, checked by hand
pnpm type-check
pnpm bundle         # installable zip in dist/
```

The tax rules live in [`src/lib/swedish-tax.ts`](src/lib/swedish-tax.ts) and are pure functions
over SEK amounts — no host API, no React. Everything that reads Wealthfolio is in
[`src/hooks/use-tax-year.ts`](src/hooks/use-tax-year.ts). If you are checking the maths, the
first file and its tests are the whole story.

## Licence

MIT.
