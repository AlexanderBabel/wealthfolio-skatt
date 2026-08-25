import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import type { ReactNode } from 'react';
import type { IncomeRow } from '../lib/swedish-tax';
import { Money } from './money';

/**
 * The heading above a table: what it is, and what it is for. Every table on
 * the page carries one, so a figure is never presented without saying where
 * it came from.
 */
export function SectionHeading({
  title,
  count,
  action,
  children,
}: {
  title: string;
  /** Shown next to the title, e.g. "12 rows". */
  count?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <h4 className="text-base font-semibold tracking-tight">
          {title}
          {count ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{count}</span>
          ) : null}
        </h4>
        {children ? <p className="text-xs text-muted-foreground">{children}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

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

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Security</TableHead>
          <TableHead>Account</TableHead>
          {showQuantity ? <TableHead className="text-right">{unit ?? 'Quantity'}</TableHead> : null}
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
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
