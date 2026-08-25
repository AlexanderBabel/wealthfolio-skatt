import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from '@wealthfolio/ui';
import { useMemo } from 'react';
import { EmptyState } from '../../components/table';
import { Section } from '../../components/section';
import { SortableHead, useTableSort } from '../../components/sortable-table';
import { Money } from '../../components/money';
import type { FundHoldingRow } from '../../lib/swedish-tax';

/** Fund/ETF schablonintakt, one line per symbol held on 1 January. */
export function FundHoldings({
  rows,
  year,
  currency,
}: {
  rows: FundHoldingRow[];
  year: number;
  currency: string;
}) {
  const columns = useMemo(
    () => ({
      symbol: { value: (r: FundHoldingRow) => r.symbol },
      type: { value: (r: FundHoldingRow) => r.typeLabel },
      quantity: { value: (r: FundHoldingRow) => r.quantity, numeric: true },
      price: { value: (r: FundHoldingRow) => r.priceSek, numeric: true },
      value: { value: (r: FundHoldingRow) => r.valueSek, numeric: true },
      schablonintakt: { value: (r: FundHoldingRow) => r.schablonintakt, numeric: true },
    }),
    [],
  );
  const { rows: sorted, sort, toggle } = useTableSort(rows, columns, {
    key: 'value',
    direction: 'desc',
  });

  const description = (
    <>
      0.4 % of each fund or ETF&apos;s value on 1 January {year}, taxed as capital income —
      separate from any gain or loss on selling it.
    </>
  );

  if (rows.length === 0) {
    return (
      <Section title="Fund schablonintäkt" description={description}>
        <EmptyState>No fund or ETF units held on 1 January {year}.</EmptyState>
      </Section>
    );
  }

  return (
    <Section
      title="Fund schablonintäkt"
      count={`${rows.length} holding(s)`}
      description={description}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead column="symbol" sort={sort} onToggle={toggle}>
              Fund
            </SortableHead>
            <SortableHead column="type" sort={sort} onToggle={toggle}>
              Type
            </SortableHead>
            <SortableHead column="quantity" sort={sort} onToggle={toggle} align="right">
              Quantity
            </SortableHead>
            <SortableHead column="price" sort={sort} onToggle={toggle} align="right">
              Price, 1 Jan
            </SortableHead>
            <SortableHead column="value" sort={sort} onToggle={toggle} align="right">
              Value
            </SortableHead>
            <SortableHead column="schablonintakt" sort={sort} onToggle={toggle} align="right">
              Schablonintäkt
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.symbol}>
              <TableCell>
                <span className="font-medium">{row.symbol}</span>
                {row.name ? <span className="ml-2 text-muted-foreground">{row.name}</span> : null}
              </TableCell>
              <TableCell className="text-muted-foreground">{row.typeLabel ?? '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
              <TableCell className="text-right">
                <Money value={row.priceSek} currency={currency} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={row.valueSek} currency={currency} />
              </TableCell>
              <TableCell className="text-right font-medium">
                <Money value={row.schablonintakt} currency={currency} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell className="text-right">
              <Money value={sorted.reduce((s, r) => s + r.valueSek, 0)} currency={currency} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={sorted.reduce((s, r) => s + r.schablonintakt, 0)} currency={currency} />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </Section>
  );
}
