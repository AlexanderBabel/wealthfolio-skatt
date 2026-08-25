import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from '@wealthfolio/ui';
import { useMemo, type ReactNode } from 'react';
import type { IncomeRow } from '../lib/swedish-tax';
import { Money } from './money';
import { SortableHead, useTableSort } from './sortable-table';

/**
 * What sits where a table would be when there is nothing to put in it. One
 * component so that an empty year reads as a consistent page rather than
 * three different opinions about how to say "none".
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * A dividend, interest credit or staking reward, listed so the summary figure
 * above it can be checked against the payments that produced it.
 */
export function IncomeTable({
  rows,
  currency,
  unit,
}: {
  rows: IncomeRow[];
  currency: string;
  /** Header for the quantity column, when the rows carry one. */
  unit?: string;
}) {
  const showQuantity = rows.some((r) => r.quantity !== undefined);
  const total = rows.reduce((sum, r) => sum + r.amountSek, 0);

  const columns = useMemo(
    () => ({
      date: { value: (r: IncomeRow) => r.date, numeric: true },
      kind: { value: (r: IncomeRow) => r.kind },
      symbol: { value: (r: IncomeRow) => r.symbol },
      account: { value: (r: IncomeRow) => r.account },
      quantity: { value: (r: IncomeRow) => r.quantity, numeric: true },
      amount: { value: (r: IncomeRow) => r.amountSek, numeric: true },
    }),
    [],
  );
  const { rows: sorted, sort, toggle } = useTableSort(rows, columns, {
    key: 'date',
    direction: 'desc',
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead column="date" sort={sort} onToggle={toggle}>
            Date
          </SortableHead>
          <SortableHead column="kind" sort={sort} onToggle={toggle}>
            Type
          </SortableHead>
          <SortableHead column="symbol" sort={sort} onToggle={toggle}>
            Security
          </SortableHead>
          <SortableHead column="account" sort={sort} onToggle={toggle}>
            Account
          </SortableHead>
          {showQuantity ? (
            <SortableHead column="quantity" sort={sort} onToggle={toggle} align="right">
              {unit ?? 'Quantity'}
            </SortableHead>
          ) : null}
          <SortableHead column="amount" sort={sort} onToggle={toggle} align="right">
            Amount
          </SortableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row, index) => (
          <TableRow key={`${row.date}-${row.symbol ?? ''}-${index}`}>
            <TableCell className="text-muted-foreground">{row.date}</TableCell>
            <TableCell className="text-muted-foreground">{row.kind ?? '—'}</TableCell>
            <TableCell className="font-medium">{row.symbol ?? '—'}</TableCell>
            <TableCell className="text-muted-foreground">{row.account}</TableCell>
            {showQuantity ? (
              <TableCell className="text-right tabular-nums">{row.quantity ?? '—'}</TableCell>
            ) : null}
            <TableCell className="text-right">
              <Money value={row.amountSek} currency={currency} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={showQuantity ? 5 : 4}>Total</TableCell>
          <TableCell className="text-right font-medium">
            <Money value={total} currency={currency} />
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
