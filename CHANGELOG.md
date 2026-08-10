# Changelog

All notable changes to the Skatt addon will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - {{currentDate}}

### Added
- Swedish capital income tax overview for ISK and depå accounts: schablonintäkt,
  fribelopp, genomsnittsmetoden cost basis, and the combined kapitalöverskott/tax figure.
- Account classification (ISK / Depå / not taxed) as a one-time setup step.
- Detection of ISK-to-ISK transfers, currency-conversion pairs, splits and broker
  re-issues, and depå-to-ISK disposals, each with the resulting warning.
- Historic statslåneräntan table (`SLR_NOV_30`) and per-era ISK rate rules
  (2012–2015, 2016–2017, 2018–).
