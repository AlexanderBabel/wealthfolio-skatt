import { describe, expect, it } from 'vitest';
import {
  buildBlanketterSru,
  buildInfoSru,
  isValidPersonnummer,
  normalizePersonnummer,
  validateFiler,
  type FilerInfo,
} from './sru';
import type { K4Summary } from './swedish-tax';

const filer: FilerInfo = {
  personnummer: '198501011234',
  name: 'Test Testsson',
  postnr: '12345',
  postort: 'Stad',
};
const now = new Date(2026, 3, 10, 12, 30, 5); // 2026-04-10 12:30:05, local time

const row = (symbol: string, name: string | undefined, vinst: number, forlust: number): K4Summary => ({
  symbol,
  name,
  quantity: 10,
  forsaljningspris: 1000,
  omkostnadsbelopp: 1000 - vinst + forlust,
  vinst,
  forlust,
});

describe('normalizePersonnummer / isValidPersonnummer', () => {
  it('strips dashes and spaces', () => {
    expect(normalizePersonnummer('19850101-1234')).toBe('198501011234');
    expect(normalizePersonnummer('19850101 1234')).toBe('198501011234');
  });

  it('accepts only 12 digits', () => {
    expect(isValidPersonnummer('198501011234')).toBe(true);
    expect(isValidPersonnummer('850101-1234')).toBe(false);
    expect(isValidPersonnummer('19850101123')).toBe(false);
  });
});

describe('validateFiler', () => {
  it('passes a valid filer', () => {
    expect(validateFiler(filer)).toEqual([]);
  });

  it('flags every field the MEDIELEV block requires', () => {
    // Skatteverket rejects the whole file if any of the four is missing, so
    // all four are reported at once rather than one dialog round-trip each.
    const errors = validateFiler({ personnummer: '123', name: '  ', postnr: '', postort: ' ' });
    expect(errors).toHaveLength(4);
  });
});

describe('buildInfoSru', () => {
  it('writes the MEDIELEV block Skatteverket expects', () => {
    const info = buildInfoSru(filer);
    const lines = info.trim().split('\r\n');

    // Exactly the four mandatory fields. #ADRESS, #KONTAKT, #EMAIL, #TELEFON,
    // #FAX and #AVDELNING are all optional, so none is written - an empty
    // optional field is not something the file needs to carry.
    expect(lines).toEqual([
      '#DATABESKRIVNING_START',
      '#PRODUKT SRU',
      '#FILNAMN BLANKETTER.SRU',
      '#DATABESKRIVNING_SLUT',
      '#MEDIELEV_START',
      '#ORGNR 198501011234',
      '#NAMN Test Testsson',
      '#POSTNR 12345',
      '#POSTORT Stad',
      '#MEDIELEV_SLUT',
    ]);
  });
});

describe('buildBlanketterSru', () => {
  it('writes one row with the exact K4 avsnitt A field codes', () => {
    const sru = buildBlanketterSru([row('AAA', 'Some Fund', 200, 0)], filer, 2026, now);
    const lines = sru.trim().split('\r\n');

    expect(lines).toEqual([
      '#BLANKETT K4-2026P4',
      '#IDENTITET 198501011234 20260410 123005',
      '#NAMN Test Testsson',
      '#UPPGIFT 3100 10',
      '#UPPGIFT 3101 AAA - Some Fund',
      '#UPPGIFT 3102 1000',
      '#UPPGIFT 3103 800',
      '#UPPGIFT 3104 200',
      '#UPPGIFT 3105 0',
      '#UPPGIFT 3300 1000',
      '#UPPGIFT 3301 800',
      '#UPPGIFT 3304 200',
      '#UPPGIFT 3305 0',
      '#UPPGIFT 7014 1',
      '#BLANKETTSLUT',
      '#FIL_SLUT',
    ]);
  });

  it('increments the field-code counter per row, 10 per row up to nine', () => {
    const rows = [row('AAA', undefined, 100, 0), row('BBB', undefined, 0, 50)];
    const sru = buildBlanketterSru(rows, filer, 2026, now);

    expect(sru).toContain('#UPPGIFT 3100 10');
    expect(sru).toContain('#UPPGIFT 3101 AAA');
    expect(sru).toContain('#UPPGIFT 3110 10');
    expect(sru).toContain('#UPPGIFT 3111 BBB');
    // Summary line 3300 etc. is the two rows combined, not per-row.
    expect(sru).toContain('#UPPGIFT 3300 2000');
    expect(sru).toContain('#UPPGIFT 3304 100');
    expect(sru).toContain('#UPPGIFT 3305 50');
  });

  it('splits into one blankett per nine rows, each with its own summary and page number', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`SYM${i}`, undefined, 10, 0));
    const sru = buildBlanketterSru(rows, filer, 2026, now);
    const blanketts = sru.split('#BLANKETT ').slice(1);

    expect(blanketts).toHaveLength(2);
    expect(blanketts[0]).toContain('#UPPGIFT 3180 10'); // 9th row on page 1, counter 18
    expect(blanketts[0]).toContain('#UPPGIFT 7014 1');
    expect(blanketts[0]).not.toContain('#UPPGIFT 3190'); // no tenth slot on one page
    expect(blanketts[1]).toContain('#UPPGIFT 3100 10'); // page 2 restarts at row 1
    expect(blanketts[1]).toContain('#UPPGIFT 7014 2');
    expect(sru.trim().endsWith('#FIL_SLUT')).toBe(true);
  });

  it('truncates beteckning to 80 characters', () => {
    const longName = 'A'.repeat(100);
    const sru = buildBlanketterSru([row('AAA', longName, 0, 0)], filer, 2026, now);
    const beteckningLine = sru.split('\r\n').find((l) => l.startsWith('#UPPGIFT 3101'))!;

    expect(beteckningLine.replace('#UPPGIFT 3101 ', '').length).toBe(80);
  });

  it('writes avsnitt D with its own field codes, on the same blankett as A', () => {
    const sru = buildBlanketterSru([row('AAA', undefined, 200, 0)], filer, 2026, now, [
      row('BTC', 'Bitcoin', 0, 300),
    ]);
    const blanketts = sru.split('#BLANKETT ').slice(1);

    expect(blanketts).toHaveLength(1);
    expect(sru).toContain('#UPPGIFT 3100 10'); // avsnitt A row 1
    expect(sru).toContain('#UPPGIFT 3410 10'); // avsnitt D row 1
    expect(sru).toContain('#UPPGIFT 3411 BTC - Bitcoin');
    expect(sru).toContain('#UPPGIFT 3412 1000');
    expect(sru).toContain('#UPPGIFT 3413 1300');
    expect(sru).toContain('#UPPGIFT 3414 0');
    expect(sru).toContain('#UPPGIFT 3415 300');
    // Avsnitt D totals are 3500/3501/3503/3504 - not the 3504/3505 pattern of A.
    expect(sru).toContain('#UPPGIFT 3500 1000');
    expect(sru).toContain('#UPPGIFT 3501 1300');
    expect(sru).toContain('#UPPGIFT 3503 0');
    expect(sru).toContain('#UPPGIFT 3504 300');
  });

  it('fits only seven avsnitt D rows on a blankett, against nine for A', () => {
    const cryptoRows = Array.from({ length: 8 }, (_, i) => row(`C${i}`, undefined, 10, 0));
    const sru = buildBlanketterSru([], filer, 2026, now, cryptoRows);
    const blanketts = sru.split('#BLANKETT ').slice(1);

    expect(blanketts).toHaveLength(2);
    expect(blanketts[0]).toContain('#UPPGIFT 3470 10'); // 7th row, 3410 + 6 x 10
    expect(blanketts[0]).not.toContain('#UPPGIFT 3480'); // no eighth slot
    expect(blanketts[1]).toContain('#UPPGIFT 3410 10'); // 8th row restarts page 2
    expect(blanketts[1]).toContain('#UPPGIFT 7014 2');
  });

  it('paginates both sections together, longest section deciding the count', () => {
    const shares = Array.from({ length: 10 }, (_, i) => row(`S${i}`, undefined, 10, 0));
    const sru = buildBlanketterSru(shares, filer, 2026, now, [row('BTC', undefined, 5, 0)]);
    const blanketts = sru.split('#BLANKETT ').slice(1);

    expect(blanketts).toHaveLength(2); // 10 share rows = 2 pages
    expect(blanketts[0]).toContain('#UPPGIFT 3410'); // the one crypto row rides along
    expect(blanketts[1]).not.toContain('#UPPGIFT 3410'); // and is not repeated
    expect(blanketts[1]).not.toContain('#UPPGIFT 3500'); // nor are its totals
  });

  it('produces one empty-but-valid blankett when there are no rows', () => {
    const sru = buildBlanketterSru([], filer, 2026, now);
    expect(sru).toContain('#BLANKETT K4-2026P4');
    expect(sru).not.toContain('#UPPGIFT 3300');
    expect(sru).toContain('#UPPGIFT 7014 1');
  });
});

