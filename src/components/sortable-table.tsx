import { TableHead } from '@wealthfolio/ui';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortColumn<T> {
  /** The value this column sorts on. Undefined always sorts last. */
  value: (row: T) => string | number | undefined;
  /**
   * True for amounts, quantities and dates - anything where the interesting
   * end is the big end, so the first click sorts descending.
   */
  numeric?: boolean;
}

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

/**
 * Orders rows by one column. Exported separately from the hook so the
 * comparator can be tested without rendering a table: the awkward cases here
 * are blanks and mixed types, not React.
 */
export function sortRows<T, K extends string>(
  rows: T[],
  columns: Record<K, SortColumn<T>>,
  { key, direction }: SortState<K>,
): T[] {
  const read = columns[key]?.value;
  if (!read) return rows;
  const sign = direction === 'asc' ? 1 : -1;

  // A copy, because Array.prototype.sort is in place and these arrays come
  // straight out of a memoised query result.
  return [...rows].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    // A row with nothing in this column sits at the bottom either way round,
    // rather than pretending to be zero or the empty string.
    if (left === undefined || left === '') return right === undefined || right === '' ? 0 : 1;
    if (right === undefined || right === '') return -1;
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign;
    return String(left).localeCompare(String(right)) * sign;
  });
}

/** Row ordering for one table, plus the state its headers need to render. */
export function useTableSort<T, K extends string>(
  rows: T[],
  columns: Record<K, SortColumn<T>>,
  // NoInfer so the column set decides what a valid key is. Without it the
  // starting key narrows K to itself, and every other header stops type-checking.
  initial: SortState<NoInfer<K>>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const toggle = (key: K) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : // Landing on a new column, start at the end worth looking at: the
          // biggest amount, or the first name alphabetically.
          { key, direction: columns[key]?.numeric ? 'desc' : 'asc' },
    );

  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);

  return { rows: sorted, sort, toggle };
}

/** A table header that sorts the table when clicked. */
export function SortableHead<K extends string>({
  column,
  sort,
  onToggle,
  align = 'left',
  children,
}: {
  column: K;
  sort: SortState<K>;
  onToggle: (key: K) => void;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const active = sort.key === column;
  const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;

  return (
    <TableHead
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={align === 'right' ? 'text-right' : undefined}
    >
      <button
        type="button"
        onClick={() => onToggle(column)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-foreground' : ''}`}
      >
        {children}
        <Icon className={`h-3.5 w-3.5 ${active ? '' : 'opacity-40'}`} aria-hidden />
      </button>
    </TableHead>
  );
}
