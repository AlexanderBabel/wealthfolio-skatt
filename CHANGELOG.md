# Changelog

All notable changes to the Skatt addon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-08-25

### Fixed
- Classifying an account did nothing visible. The dropdown was bound to the portfolio
  query, so saving a wrapper invalidated the whole thing — every account valuation,
  quote history and exchange-rate series — and the control snapped back to the previous
  value until that finished. The wrapper map is now its own cheap storage-backed query,
  written optimistically on click, with the portfolio re-read running behind it.
  Changing several accounts in a row no longer races.

### Changed
- **One export, in one place.** The Skatteverket export moved out of the Depå and Crypto
  tabs into the page header. There was only ever one K4 — avsnitt A and D share the same
  blanketter in a single `BLANKETTER.SRU` — but offering the button on two tabs implied
  two filings. The dialog now states what it is about to write: rows per section, and
  how many blanketter that comes to.
- The crypto row-granularity choice (per disposal or per coin) moved into that dialog,
  next to the file it actually affects. The Crypto tab's CSV always mirrors its table.
- An empty avsnitt D now says so, and points at the Accounts tab, instead of silently
  exporting a K4 with only the depå rows in it.
- Dropped the bitcoin icon from the Crypto tab; it now matches the other tab labels.

### Added
- **Dividends and interest** are now listed on the Depå tab, and **staking, earn and airdrop
  rewards** on the Crypto tab — one row per payment behind each summary figure, rather than
  only the total.
- Every table now carries a caption saying what it is and where its figures come from.
- Account classification is staged: set several accounts, then **Save and re-read portfolio**
  once. Unsaved rows are marked, and the previous read is cancelled before a new one starts,
  so the progress bar no longer jumps backwards when two reads overlap.
- Re-reading the portfolio after an account change shows the progress bar again and puts
  the four summary cards into a skeleton state, rather than leaving stale figures on
  screen looking settled.
- `buildCryptoEvents` is now a pure exported function with its own tests, covering swap
  pairing against a same-day reward drip, own-wallet moves, and untraceable transfers out.

### Changed
- Split the two files that had grown to hold most of the addon. `tax-page.tsx` went from
  1 400 lines to a 250-line composition root, with each tab, the export dialog and the shared
  presentational pieces in their own module; the data hook split into the portfolio read and
  the per-year computation. `buildCryptoEvents`, the date and activity helpers and addon
  storage moved to `lib/`, which now imports nothing from `hooks/` or `pages/` — so every tax
  rule is testable without React. Tests moved next to the code they cover.
- `noUnusedLocals`, `noUnusedParameters` and `noFallthroughCasesInSwitch` are on, so CI fails
  on dead imports rather than accumulating them.
- Tests run pinned to `Europe/Stockholm`. A Swedish tax year is a local calendar year, so the
  date handling is timezone dependent by nature — a trade at 22:00Z on 31 May is a 1 June trade
  in Stockholm, and a CI runner on UTC was reading it as May.
- Renamed the internal table heading component to `SectionHeading`; it had been shadowing the
  UI kit's own `TableCaption` export.

### Security
- Test fixtures and code comments no longer carry real tickers, amounts or account names, and
  the contributing notes now require fixtures to be synthetic. Nothing beyond a single vendor
  name in one comment had reached the public repository.

## [1.0.1] - 2026-08-25

### Changed

- Addon id renamed from `wealthfolio-addon-skatt` to `wealthfolio-skatt`, matching
  the repository name. The sidebar route moves to `/addons/wealthfolio-skatt` and
  the release zip is now `wealthfolio-skatt-<version>.zip`. Wealthfolio keys an
  installed addon by its id, so an existing install is not upgraded in place —
  remove the old one and install this build from file.
- Author is now the GitHub handle `AlexanderBabel`, matching the directory listing.

## [1.0.0] - 2026-08-25

First public release.

### Added

**ISK**
- Schablonintäkt per calendar year: kapitalunderlag from the four quarter-start
  values plus deposits, quoted at the year's rate.
- Historic statslåneräntan table (`SLR_NOV_30`) back to 2011, with the per-era rate
  rules applied as they stood: 2012–2015 the bare rate, 2016–2017 plus 0.75 points
  with a 1.25 % floor, 2018– plus a full point.
- Fribelopp (150 000 kr for 2025, 300 000 kr for 2026), shared across accounts in
  proportion to each one's underlag and never exceeding it.

**Depå**
- Genomsnittsmetoden cost basis, pooled per security across every depå account and
  recomputed from the full imported history rather than the reported year alone.
- Schablonmetoden (20 % of proceeds) flagged per disposal where it would beat the
  average cost, and used as the fallback when no purchase is on record.
- 0.4 % fund schablonintäkt on fund and ETF units held on 1 January, with the
  fund/ETF classification taken from Wealthfolio's own taxonomy first, the market
  data provider second, and the security's name last.
- Detection of depå-to-ISK transfers as disposals, ISK-to-ISK transfers as
  non-events, currency-conversion pairs, splits, and broker re-issues.

**Crypto (K4 avsnitt D)**
- A third account classification, `Crypto`, with its own genomsnittsmetoden pool per
  coin, kept separate from the depå pool.
- Avsnitt D loss rule: gains taxed in full, losses deductible at 70 %, and no netting
  between them — unlike avsnitt A.
- Schablonmetoden suppressed, since the 20 % rule does not exist for andra tillgångar;
  a sale with no purchase on record gets an omkostnadsbelopp of 0 and a warning.
- Crypto-to-crypto swaps detected from same-day transfer pairs and booked as a
  disposal at the market value of what was received, plus an acquisition of the new
  coin. Where several transfers land on one day, each outgoing leg takes the incoming
  leg closest to it in value.
- Staking, earn and airdrop rewards booked as capital income on receipt and carried
  into the pool at that value, with a warning covering mined coins and true airdrops.

**Export**
- K4 CSV export, semicolon-separated and comma-decimal.
- SRU export (`INFO.SRU` + `BLANKETTER.SRU`) for K4 avsnitt A and avsnitt D, using
  Skatteverket's own field codes: A at 3100–3185 with totals 3300/3301/3304/3305,
  D at 3410–3475 with totals 3500/3501/3503/3504. Nine rows per blankett for A,
  seven for D, both sections sharing the same pages.
- Per-disposal or per-coin K4 rows for crypto, switchable, driving both CSV and SRU.

**Everything else**
- Account classification (ISK / Depå / Crypto / not taxed) as a one-time setup step.
- Combined kapitalöverskott, tax at 30 %, and skattereduktion on a deficit
  (30 % of the first 100 000, 21 % above).
- Per-date FX conversion, so a 2019 trade is converted at the 2019 rate.
- Warnings grouped by category rather than listed one per activity.
