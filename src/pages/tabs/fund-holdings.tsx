import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@wealthfolio/ui';
import { EmptyState, SectionHeading } from '../../components/table';
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
  const sorted = [...rows].sort((a, b) => b.valueSek - a.valueSek);

  if (sorted.length === 0) {
    return (
      <div className="space-y-2">
        <SectionHeading title="Fund schablonintäkt">
          0.4 % of each fund or ETF&apos;s value on 1 January {year}, taxed as capital income —
          separate from any gain or loss on selling it.
        </SectionHeading>
        <EmptyState>No fund or ETF units held on 1 January {year}.</EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SectionHeading title="Fund schablonintäkt" count={`${sorted.length} holding(s)`}>
        0.4 % of each fund or ETF&apos;s value on 1 January {year}, taxed as capital income —
        separate from any gain or loss on selling it.
      </SectionHeading>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fund</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead className="text-right">Price, 1 Jan</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Schablonintäkt</TableHead>
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
    </div>
  );
}
