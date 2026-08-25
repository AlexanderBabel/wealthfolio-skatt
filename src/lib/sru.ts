/**
 * BLANKETTER.SRU / INFO.SRU for K4 avsnitt A - the file pair Skatteverket's
 * e-service accepts as an upload alongside Inkomstdeklaration 1.
 *
 * Field codes are Skatteverket's own K4 faltnamnstabell (Bilaga 1 to SKV269,
 * "K4_<year>P4.DOCX"), cross-checked against ebtcap/K4SRU, a maintained
 * open-source K4 SRU generator. Two sections are modelled:
 *
 *   A  marknadsnoterade delagarratter - listed shares, ETFs included.
 *      Nine rows per blankett, totals to ruta 54 / 81.
 *   D  ovriga vardepapper, andra tillgangar - where kryptovaluta belongs.
 *      Only SEVEN rows per blankett, and the totals carry their own codes
 *      to ruta 64 / 83, where Skatteverket applies the 70 % on the loss.
 *
 * Avsnitt B and C are still left out rather than guessed at.
 */

import type { K4Summary } from './swedish-tax';

/**
 * The form-version suffix on the blankett id (K4-<year>P4). Stable since at
 * least 2014 per Skatteverket's own document history - if a future year's
 * form changes it, this is the one constant to update.
 */
const K4_BLANKETT_SUFFIX = 'P4';

/**
 * How each modelled section is laid out on one blankett. `first` is the field
 * code of the first row's Antal; every row is 10 codes further on, and within
 * a row the six codes run Antal, Beteckning, Forsaljningspris,
 * Omkostnadsbelopp, Vinst, Forlust. `sum` is [forsaljningspris,
 * omkostnadsbelopp, vinst, forlust] - not contiguous, and not the same offsets
 * in both sections, so they are spelled out.
 */
const SECTIONS = {
  A: { first: 3100, rowsPerPage: 9, sum: [3300, 3301, 3304, 3305] },
  D: { first: 3410, rowsPerPage: 7, sum: [3500, 3501, 3503, 3504] },
} as const;

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

/** The six #UPPGIFT lines of one row, plus the section totals for the page. */
function sectionLines(section: keyof typeof SECTIONS, page: K4Summary[]): string[] {
  const { first, sum } = SECTIONS[section];
  const lines: string[] = [];

  page.forEach((row, i) => {
    const code = first + i * 10;
    const beteckning = (row.name ? `${row.symbol} - ${row.name}` : row.symbol).slice(
      0,
      BETECKNING_MAX_LENGTH,
    );
    lines.push(`#UPPGIFT ${code} ${row.quantity}`);
    lines.push(`#UPPGIFT ${code + 1} ${beteckning}`);
    lines.push(`#UPPGIFT ${code + 2} ${row.forsaljningspris}`);
    lines.push(`#UPPGIFT ${code + 3} ${row.omkostnadsbelopp}`);
    lines.push(`#UPPGIFT ${code + 4} ${row.vinst}`);
    lines.push(`#UPPGIFT ${code + 5} ${row.forlust}`);
  });

  if (page.length > 0) {
    const totals = sumK4(page);
    const values = [totals.forsaljningspris, totals.omkostnadsbelopp, totals.vinst, totals.forlust];
    sum.forEach((code, i) => lines.push(`#UPPGIFT ${code} ${values[i]}`));
  }

  return lines;
}

/**
 * One blankett carries both sections, so the two paginate together: a filing
 * with 12 share rows and 3 crypto rows is two blanketter, the crypto rows
 * riding along on the first.
 */
export function buildBlanketterSru(
  rows: K4Summary[],
  filer: FilerInfo,
  year: number,
  now: Date,
  cryptoRows: K4Summary[] = [],
): string {
  const pagesA = paginate(rows, SECTIONS.A.rowsPerPage);
  const pagesD = paginate(cryptoRows, SECTIONS.D.rowsPerPage);
  const pageCount = Math.max(pagesA.length, pagesD.length);
  const identitet = `${filer.personnummer} ${stamp(now)}`;
  const lines: string[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    lines.push(`#BLANKETT K4-${year}${K4_BLANKETT_SUFFIX}`);
    lines.push(`#IDENTITET ${identitet}`);
    lines.push(`#NAMN ${filer.name}`);
    lines.push(...sectionLines('A', pagesA[pageIndex] ?? []));
    lines.push(...sectionLines('D', pagesD[pageIndex] ?? []));
    lines.push(`#UPPGIFT 7014 ${pageIndex + 1}`);
    lines.push('#BLANKETTSLUT');
  }

  lines.push('#FIL_SLUT');
  return lines.join(CRLF) + CRLF;
}
