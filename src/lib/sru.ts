/**
 * BLANKETTER.SRU / INFO.SRU for K4 avsnitt A - the file pair Skatteverket's
 * e-service accepts as an upload alongside Inkomstdeklaration 1.
 *
 * Field codes are Skatteverket's own K4 faltnamnstabell (Bilaga 1 to SKV269,
 * "K4_<year>P4.DOCX"), cross-checked against ebtcap/K4SRU, a maintained
 * open-source K4 SRU generator. Only avsnitt A (marknadsnoterade
 * delagarratter - listed shares, ETFs included) is modelled; this addon does
 * not compute avsnitt C (currency) or D (unlisted/other), so those sections
 * are left out rather than guessed at.
 */

import type { K4Summary } from './swedish-tax';

/**
 * The form-version suffix on the blankett id (K4-<year>P4). Stable since at
 * least 2014 per Skatteverket's own document history - if a future year's
 * form changes it, this is the one constant to update.
 */
const K4_BLANKETT_SUFFIX = 'P4';

/** Skatteverket splits avsnitt A across pages of at most this many rows. */
const K4_ROWS_PER_PAGE = 9;

/** Str_80 in Skatteverket's field table - beteckning is truncated to fit. */
const BETECKNING_MAX_LENGTH = 80;

const CRLF = '\r\n';

export interface FilerInfo {
  /** 12 digits, no dashes - use normalizePersonnummer() first. */
  personnummer: string;
  name: string;
  postnr: string;
  postort: string;
}

export const normalizePersonnummer = (input: string): string => input.replace(/\D/g, '');

export const isValidPersonnummer = (personnummer: string): boolean => /^\d{12}$/.test(personnummer);

export function validateFiler(filer: FilerInfo): string[] {
  const errors: string[] = [];
  if (!isValidPersonnummer(filer.personnummer)) {
    errors.push('Personnummer must be 12 digits (ÅÅÅÅMMDDXXXX), no dashes.');
  }
  if (!filer.name.trim()) {
    errors.push('Name is required.');
  }
  if (!filer.postnr.trim()) {
    errors.push('Postnummer is required.');
  }
  if (!filer.postort.trim()) {
    errors.push('Postort is required.');
  }
  return errors;
}

export function buildInfoSru(filer: FilerInfo): string {
  return (
    [
      '#DATABESKRIVNING_START',
      '#PRODUKT SRU',
      '#FILNAMN BLANKETTER.SRU',
      '#DATABESKRIVNING_SLUT',
      '#MEDIELEV_START',
      `#ORGNR ${filer.personnummer}`,
      `#NAMN ${filer.name}`,
      `#POSTNR ${filer.postnr}`,
      `#POSTORT ${filer.postort}`,
      '#MEDIELEV_SLUT',
    ].join(CRLF) + CRLF
  );
}

/** yyyyMMdd HHmmss in the local clock - the format #IDENTITET wants. */
function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())} ` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

const paginate = <T>(items: T[], perPage: number): T[][] => {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
};

const sumK4 = (rows: K4Summary[]) =>
  rows.reduce(
    (sum, r) => ({
      forsaljningspris: sum.forsaljningspris + r.forsaljningspris,
      omkostnadsbelopp: sum.omkostnadsbelopp + r.omkostnadsbelopp,
      vinst: sum.vinst + r.vinst,
      forlust: sum.forlust + r.forlust,
    }),
    { forsaljningspris: 0, omkostnadsbelopp: 0, vinst: 0, forlust: 0 },
  );

export function buildBlanketterSru(
  rows: K4Summary[],
  filer: FilerInfo,
  year: number,
  now: Date,
): string {
  const pages = paginate(rows, K4_ROWS_PER_PAGE);
  const identitet = `${filer.personnummer} ${stamp(now)}`;
  const lines: string[] = [];

  pages.forEach((page, pageIndex) => {
    lines.push(`#BLANKETT K4-${year}${K4_BLANKETT_SUFFIX}`);
    lines.push(`#IDENTITET ${identitet}`);
    lines.push(`#NAMN ${filer.name}`);

    page.forEach((row, i) => {
      const counter = 10 + i;
      const beteckning = (row.name ? `${row.symbol} - ${row.name}` : row.symbol).slice(
        0,
        BETECKNING_MAX_LENGTH,
      );
      lines.push(`#UPPGIFT 3${counter}0 ${row.quantity}`);
      lines.push(`#UPPGIFT 3${counter}1 ${beteckning}`);
      lines.push(`#UPPGIFT 3${counter}2 ${row.forsaljningspris}`);
      lines.push(`#UPPGIFT 3${counter}3 ${row.omkostnadsbelopp}`);
      lines.push(`#UPPGIFT 3${counter}4 ${row.vinst}`);
      lines.push(`#UPPGIFT 3${counter}5 ${row.forlust}`);
    });

    if (page.length > 0) {
      const totals = sumK4(page);
      lines.push(`#UPPGIFT 3300 ${totals.forsaljningspris}`);
      lines.push(`#UPPGIFT 3301 ${totals.omkostnadsbelopp}`);
      lines.push(`#UPPGIFT 3304 ${totals.vinst}`);
      lines.push(`#UPPGIFT 3305 ${totals.forlust}`);
    }

    lines.push(`#UPPGIFT 7014 ${pageIndex + 1}`);
    lines.push('#BLANKETTSLUT');
  });

  lines.push('#FIL_SLUT');
  return lines.join(CRLF) + CRLF;
}
