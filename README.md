<h1 align="center">Skatt</h1>

<p align="center">
  <strong>Swedish capital income tax, per calendar year, inside Wealthfolio.</strong><br>
  ISK, depå and crypto — with a K4 export you can upload to Skatteverket.
</p>

<p align="center">
  <a href="https://github.com/AlexanderBabel/wealthfolio-skatt/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/AlexanderBabel/wealthfolio-skatt?style=flat-square"></a>
  <a href="https://github.com/AlexanderBabel/wealthfolio-skatt/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/AlexanderBabel/wealthfolio-skatt/ci.yml?branch=main&style=flat-square&label=ci"></a>
  <a href="LICENSE"><img alt="Licence" src="https://img.shields.io/badge/licence-MIT-blue?style=flat-square"></a>
  <img alt="Wealthfolio" src="https://img.shields.io/badge/Wealthfolio-%E2%89%A5%203.6.2-6366f1?style=flat-square">
</p>

---

Wealthfolio knows every trade you made. Skatteverket wants those trades expressed as
schablonintäkt, omkostnadsbelopp and vinst/förlust. This addon does that translation, per
calendar year, and shows its working at every step — so you can check it rather than trust it.

> [!IMPORTANT]
> **This is an estimate, not a declaration.** It reads what you imported into Wealthfolio, which
> is not the same thing as your brokers' tax statements. Reconcile against those before you file.
> The author is not a tax adviser, and neither is this software.

## Install

1. Download **`wealthfolio-skatt-<version>.zip`** from the
   [latest release](https://github.com/AlexanderBabel/wealthfolio-skatt/releases/latest).
2. In Wealthfolio, go to **Settings → Addons → Install Addon** and pick the zip.
3. Review the permissions and approve. Restart Wealthfolio.
4. **Skatt** appears in the sidebar.

Requires Wealthfolio 3.6.2 or newer. Your base currency should be SEK — the addon says so
loudly if it is not, because Swedish tax is assessed in kronor and every figure would be off.

### Permissions, and why each one is needed

Nothing leaves your machine. The addon makes no network requests of its own; the files it
writes go where you point the save dialog.

| Permission | What it is for |
|---|---|
| `accounts.getAll` | List your accounts so you can classify each as ISK, Depå or Crypto. |
| `activities.getAll` | Read trades, deposits, dividends and interest — the raw material. |
| `portfolio.getHistoricalValuations` | Account value at each quarter start, for the ISK kapitalunderlag. |
| `portfolio.getHoldings` | Tell fund and ETF units apart from ordinary shares. |
| `assets.getProfile` | The same, for a position you have since sold out of entirely. |
| `quotes.getHistory` | Price a holding on 1 January, and convert old trades at the rate on their own date. |
| `currency.getAll` | Find which exchange-rate series exist. |
| `events.onUpdateComplete` | Notice when a trade or import changes the portfolio, and refresh. |
| `files.openSaveDialog` | Write the CSV and SRU exports where you choose. |

## Quick start

1. Open **Skatt** in the sidebar and go to the **Accounts** tab.
2. Mark each account as **ISK**, **Depå**, **Crypto**, or leave it as *Not taxed here*.
3. Click **Save and re-read portfolio**. Changes are staged until you do, so you can set every
   account first and pay for the re-read once.
4. Pick a year. That is the whole setup.

An account left as *Not taxed here* contributes nothing — no disposals, no dividends, no
schablonintäkt. If a tab looks emptier than you expect, that is the first thing to check.

The tabs then show each wrapper's figures, the disposals behind them, and the combined
kapitalöverskott with the tax or refund it produces.

Reading the portfolio is the slow part, so results are cached — but not on a timer you have to
wait out. Wealthfolio tells the addon the moment a trade, edit or import lands, and the cache is
dropped there and then. The refresh button by the year picker re-reads everything on demand.
The cache lives in memory only; it is gone when Wealthfolio restarts.

## Filing with Skatteverket

Both exports live on the **Depå** and **Crypto** tabs.

**CSV** — semicolon-separated, comma-decimal, the way Swedish Excel expects. For checking the
numbers, or typing them into the web form yourself.

**SRU** — the file pair Skatteverket's e-service accepts alongside Inkomstdeklaration 1:

1. Click **Export SRU**, fill in personnummer, name, postnummer and postort the first time.
   All four are mandatory in the SRU identity block — the service rejects the file if any is
   missing. They are saved locally for next year.
2. Save **`INFO.SRU`** and **`BLANKETTER.SRU`** to the same folder. Two buttons, one per file,
   because the native save dialog only reliably opens once per click.
3. Upload both, as two separate files, **not zipped together**.

> [!WARNING]
> The filenames matter. Skatteverket rejects a renamed duplicate such as `blanketter (1).sru`,
> so save into an empty folder rather than one that already holds last year's.

Covers **K4 avsnitt A** (listed shares and ETFs) and **K4 avsnitt D** (crypto). Field codes come
from Skatteverket's own K4 fältnamnstabell (`K4-<year>P4`, bilaga 1 to SKV 269): A at 3100–3185
with totals 3300/3301/3304/3305, D at 3410–3475 with totals 3500/3501/3503/3504. Both sections
share the same blanketter and paginate at different rates — nine rows per page for A, seven
for D — the way the paper form does.

---

# How the numbers are computed

Everything below is reference material. You do not need it to use the addon; you need it to
audit the addon, which is the point.

## ISK

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

## Depå

Omkostnadsbeloppet uses **genomsnittsmetoden**: the average cost of every share of that
security held, pooled across all accounts marked Depå, recomputed from the full history rather
than the reported year alone. Courtage is folded in — it raises the omkostnadsbelopp on a buy
and lowers the försäljningspris on a sale (44 kap. 13 § IL) rather than being deducted
separately.

Sales where **schablonmetoden** (20 % of the proceeds) would give a lower gain are flagged, but
the figures always use the average cost. Where no purchase is on record at all, schablonmetoden
is used as the fallback and the row is marked.

**A transfer is not a sale.** Moving securities out of a depå and into an ISK *is* a disposal at
market value, because the shares leave the taxable wrapper — that, and only that. Moving them
to another depå changes nothing, since the average cost is pooled across depå accounts anyway.
A transfer whose other leg is missing takes the shares off the holding without a taxable event
and says so. The two legs are matched on security and quantity within seven days, because
settlement rarely puts them on the same date.

**Fund units** — ETFs included — held in a depå carry an extra tax on top of any gain: 0.4 % of
their value on 1 January, as capital income (42 kap. 43–44 §§ IL). It applies to Swedish and
foreign funds alike, and has not changed since it was introduced in 2012; it does **not** apply
to funds held in an ISK, since that wrapper is already taxed on its whole balance. Each fund gets
its own line on the Depå tab: quantity, price and value on 1 January, and the schablonintäkt it
produced.

<details>
<summary>How a holding is judged to be a fund</summary>

- **Wealthfolio's own "Instrument Type" classification**, when the position is currently open and
  Wealthfolio managed to classify it. Its `ETF`, `FUND`, `FUND_MUTUAL` and `FUND_FOF` categories
  count, `ETN` and `ETC` deliberately do not, since those are debt and commodity notes rather than
  fund units. When this is available, positive or negative, it wins outright.
- Otherwise, **the market data provider's instrument type or the security's name**, whichever
  says fund first. The name is checked unconditionally rather than only as a last resort, because
  a provider that has never priced a Xetra-listed UCITS ETF often tags it `EQUITY` instead of
  leaving the field blank — trusting that blindly would silently drop a real fund. `UCITS`, `ETF`
  and `FUND`/`FOND` in the name are the patterns checked; `UCITS` in particular is a regulatory
  label a stock never carries, so a hit there is treated as good as an explicit type.

A holding neither check can identify is flagged as a warning and left out of the figure rather
than guessed at — and so is the rarer disagreement, where Wealthfolio's own classification says
something other than fund but the name still looks like one.

</details>

A **split or a broker re-issue** shows up as a transfer out and a transfer in of the same
security in the *same* account, days apart, with a different share count on each side. That is
not a disposal either: the cost basis carries over untouched and only the number of shares
changes. Brokers that book a split as its own `SPLIT` row instead are handled too — the ratio
multiplies the share count and leaves the omkostnadsbelopp alone, which is also what a reverse
split does, with a ratio below one.

## Crypto

Kryptovaluta is not a delägarrätt. It is an *annan tillgång*, declared on **K4 avsnitt D**, and
three things follow from that — each one a way to get the number wrong if you reuse the Depå
logic:

- **Losses count at 70 %, and they do not net against gains first.** In avsnitt A a −10 000 wipes
  out a +10 000 completely. In avsnitt D it does not: the gain is taxed in full, the loss is
  quoted down to 7 000, and 3 000 is left to be taxed. A loss still helps — a pure loss year
  becomes a skattereduktion of 30 % of the deductible 70 %, so roughly 21 öre back per krona lost.
- **Schablonmetoden does not exist here.** The 20 %-of-proceeds fallback is a rule for listed
  delägarrätter only. Where a purchase is missing from the imported history, the omkostnadsbelopp
  is 0 and the whole sale is taxed — the addon warns rather than quietly inventing a cost basis.
- **Its own pool.** Genomsnittsmetoden runs per coin across every account marked Crypto, entirely
  separate from the depå pool. A ticker that exists in both never pools together.

**Swapping one coin for another is a sale.** So is spending crypto. A swap arrives in Wealthfolio
as a transfer out of one coin and a transfer in of another, same account, same day; the addon
pairs them and books the outgoing leg as a disposal at the market value of what came back — that
being the försäljningspris Skatteverket asks for, not what the coin you gave up was quoted at.
Where several transfers land on one day, each outgoing leg takes the incoming leg closest to it
in value, so a monthly reward drip does not get mistaken for the other half of a real swap.

**Incoming transfers with nothing to match** — staking payouts, exchange earn programmes,
airdrops — are booked as capital income at their value on arrival, and that same value becomes
the coin's omkostnadsbelopp, so it is not taxed twice when you eventually sell. That is the right
treatment for staking and earn. It is *not* right for mined coins (inkomst av tjänst) or for a
pure airdrop you did nothing to receive (normally untaxed on arrival, omkostnadsbelopp 0); the
addon warns when it books any, and those you fix by hand.

Moving a coin between two of your own accounts, both marked Crypto, is not a disposal — the
pooled cost carries across, same as between two depås. A transfer out with no traceable
destination is removed from the holding without a taxable event, and warned about.

Skatteverket asks for **one K4 row per disposal** for crypto, where avsnitt A is summarised per
security for the whole year. The Crypto tab defaults to that and offers one-row-per-coin as the
compact alternative; the choice drives both the CSV and avsnitt D in the SRU export.

## Putting them together

Gains and losses on listed delägarrätter offset each other in full. A residual net loss counts
at 70 % against other capital income — including the ISK schablonintäkt and the fund
schablonintäkt, which is why a bad year in the depå lowers the tax on both. A surplus is taxed
at 30 %; a deficit becomes a tax reduction of 30 % up to 100 000 kr and 21 % above.

## Partial and incomplete years

- **The current year** is computed from the quarters that have started; the ones that have not
  are filled with the latest known value and marked `*`. The number will move.
- **A quarter with no valuation** is counted as 0, and listed as a warning. If the account had
  no activity at all before that date it was genuinely empty, and no warning is raised.

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
unaffected. The value is not fetched: Riksbank's API publishes the 5-year government bond yield,
which is the input Riksgälden averages, **not** statslåneräntan itself — close enough to look
right and wrong enough to matter.

## Not implemented

Contributions welcome; these are deliberate omissions rather than oversights.

| Missing | Why, and what it would take |
|---|---|
| **K4 avsnitt C in the SRU export** | The export covers avsnitt A (listed shares, ETFs included) and avsnitt D (crypto) — the sections this addon computes disposals for. Currency gains (avsnitt C, see below) are not modelled, so they are not in the export either. Unlisted securities also belong in avsnitt D but are not detected as such; only accounts you mark **Crypto** feed that section. |
| **Mining income, and airdrops you did nothing for** | Every unmatched incoming crypto transfer is booked as capital income at its value on arrival. That is right for staking and earn rewards. Mined coins belong in inkomst av tjänst, and a pure airdrop is normally untaxed on receipt with an omkostnadsbelopp of 0 — the addon warns, but you adjust those by hand. |
| **Kapitalförsäkring** | Different formula: value on 1 Jan plus premiums paid, those in the second half counted at half. It shares the fribelopp with ISK, so adding it changes the ISK numbers too. |
| **Gross dividends and foreign withholding tax** | Wealthfolio records what was credited to the account. If your import books dividends net of withholding, the addon cannot recover the gross figure or the tax paid, and INK1 7.2 wants gross. Withholding recorded as a separate `TAX` activity inside an ISK is shown as an informational line only. |
| **Avräkning av utländsk skatt** | The real spärrbelopp prorates against income the addon cannot see. |
| **Avsnitt C (currency gains)** | Disposing of a foreign currency balance is itself a taxable event. Not modelled. |
| **Riksbank fixings** | Amounts are converted with Wealthfolio's own daily rate history for the date of the transaction, not the Riksbank fixing a declaration would use. Small, but it is a difference. |
| **Precise fund classification** | Whether a foreign holding counts as a fund for schablonintäkt purposes is a case-by-case legal question for anything that is not a plain UCITS fund. The addon's guess is a good proxy but not authoritative — a warning is raised whenever a holding could not be classified at all, or when Wealthfolio's own classification disagrees with what the name suggests. Check anything unusual by hand. |

## Development

```bash
pnpm install
pnpm dev:server     # live reload against a running Wealthfolio
pnpm test           # the calculation, checked by hand
pnpm type-check
pnpm bundle         # installable zip in dist/
```

### Layout

The rule that decides where a thing goes: **`lib/` may not import from `hooks/` or `pages/`.**
Everything that is a tax rule is therefore a pure function over SEK amounts, testable without a
React renderer or a running Wealthfolio — which is why the test suite needs neither.

```
src/
  lib/          pure logic, no host API and no React
    swedish-tax.ts    the rules: schablonintäkt, genomsnittsmetoden, avsnitt D
    crypto-events.ts  activities -> K4 avsnitt D events (swaps, rewards)
    sru.ts            INFO.SRU / BLANKETTER.SRU writers, Skatteverket field codes
    csv.ts, dates.ts, activities.ts, storage.ts
  hooks/        everything that reads Wealthfolio
    use-tax-data.ts   the slow portfolio read, cached and cancellable
    use-tax-year.ts   one year's activities -> the inputs swedish-tax.ts wants
  components/   presentational pieces shared across tabs
  pages/
    tax-page.tsx      composition root: year picker, export, tabs
    tabs/             one file per tab
```

If you are checking the maths, [`src/lib/swedish-tax.ts`](src/lib/swedish-tax.ts) and its tests
are the whole story. Tests sit next to the file they cover.

> [!IMPORTANT]
> **Test fixtures must be synthetic.** This is a public repository, so no test, comment or doc
> may carry anyone's real tickers, quantities, account names or personnummer — a fixture copied
> out of a live portfolio publishes that portfolio. Use placeholder tickers (`AAA`, `BBB`),
> a placeholder venue (`Exchange`, `Broker`) and round numbers. The *shape* is what the tests
> are for; the real values add nothing and cannot be taken back once pushed.

Bug reports are most useful with the warning text the addon showed you and the shape of the
activities behind it. Please do not paste real personnummer, account names or holdings into an
issue — describe the shape instead.

### Releasing

Bump the version in `package.json` and `manifest.json`, add a `CHANGELOG.md` section, then:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

CI builds the zip and publishes the GitHub Release with that CHANGELOG section as the notes.

## Licence

MIT — see [LICENSE](LICENSE).
