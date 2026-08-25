import { describe, expect, it } from 'vitest';
import { sortRows, type SortColumn } from './sortable-table';

interface Row {
  symbol: string;
  result: number;
  note?: string;
}

const columns: Record<'symbol' | 'result' | 'note', SortColumn<Row>> = {
  symbol: { value: (r) => r.symbol },
  result: { value: (r) => r.result, numeric: true },
  note: { value: (r) => r.note },
};

const rows: Row[] = [
  { symbol: 'BBB', result: -500 },
  { symbol: 'AAA', result: 1200, note: 'checked' },
  { symbol: 'CCC', result: 0 },
];

describe('sortRows', () => {
  it('puts the biggest loss and the biggest gain at opposite ends', () => {
    const desc = sortRows(rows, columns, { key: 'result', direction: 'desc' });
    expect(desc.map((r) => r.result)).toEqual([1200, 0, -500]);

    const asc = sortRows(rows, columns, { key: 'result', direction: 'asc' });
    expect(asc.map((r) => r.result)).toEqual([-500, 0, 1200]);
  });

  it('compares text as text, not by numeric coercion', () => {
    expect(sortRows(rows, columns, { key: 'symbol', direction: 'asc' }).map((r) => r.symbol)).toEqual(
      ['AAA', 'BBB', 'CCC'],
    );
  });

  it('leaves blank cells at the bottom whichever way it is sorted', () => {
    // A row with no note must not sort as if the note were "" or 0, or the
    // rows worth reading get buried under the ones with nothing in them.
    const asc = sortRows(rows, columns, { key: 'note', direction: 'asc' });
    const desc = sortRows(rows, columns, { key: 'note', direction: 'desc' });
    expect(asc[0].note).toBe('checked');
    expect(desc[0].note).toBe('checked');
    expect(asc.at(-1)?.note).toBeUndefined();
    expect(desc.at(-1)?.note).toBeUndefined();
  });

  it('does not reorder the array it was given', () => {
    const original = [...rows];
    sortRows(rows, columns, { key: 'result', direction: 'asc' });
    expect(rows).toEqual(original);
  });

  it('passes rows through untouched for a column it does not know', () => {
    const unknown = { key: 'nope' as 'symbol', direction: 'asc' as const };
    expect(sortRows(rows, {} as typeof columns, unknown)).toBe(rows);
  });
});
