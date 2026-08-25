import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  Badge,
  Button,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import { Download } from 'lucide-react';
import { useMemo } from 'react';
import { Money } from '../../components/money';
import { EmptyState, IncomeTable } from '../../components/table';
import { Section } from '../../components/section';
import { SortableHead, useTableSort } from '../../components/sortable-table';
import { k4Csv } from '../../lib/csv';
import { detailK4, type K4Row, type TaxYearResult } from '../../lib/swedish-tax';

/**
 * K4 avsnitt D. Crypto is an "annan tillgang", not a delagarratt, so three
 * things differ from the Depa tab: its own average-cost pool per coin, no
 * schablonmetoden, and losses that count at 70 % without netting against
 * gains first.
 */
export function CryptoTab({
  ctx,
  result,
  currency,
}: {
  ctx: AddonContext;
  result: TaxYearResult;
  currency: string;
}) {
  const { crypto } = result;
  // The CSV mirrors the table above it, one line per disposal. How the K4
  // itself is grouped is asked at export time instead.
  const cryptoRows = detailK4(crypto.rows);

  const columns = useMemo(
    () => ({
      date: { value: (r: K4Row) => r.date, numeric: true },
      symbol: { value: (r: K4Row) => r.symbol },
      account: { value: (r: K4Row) => r.account },
      quantity: { value: (r: K4Row) => r.quantity, numeric: true },
      proceeds: { value: (r: K4Row) => r.forsaljningspris, numeric: true },
      cost: { value: (r: K4Row) => r.omkostnadsbelopp, numeric: true },
      result: { value: (r: K4Row) => r.result, numeric: true },
    }),
    [],
  );
  const { rows: sorted, sort, toggle } = useTableSort(crypto.rows, columns, {
    key: 'date',
    direction: 'desc',
  });

  const totalCapitalIncome = crypto.deductibleResult + crypto.rewards;

  const summary: Array<[string, number, string?]> = [
    ['Gains', crypto.gains, 'taxed in full'],
    ['Losses', -crypto.losses, 'deductible at 70 %'],
    ['Rewards', crypto.rewards, 'staking, earn and airdrops — taxed on receipt'],
    ['Total capital income', totalCapitalIncome],
  ];

  const exportCsv = async () => {
    try {
      await ctx.api.files.openSaveDialog(k4Csv(cryptoRows), `K4-avsnitt-D-${result.year}.csv`);
    } catch (error) {
      ctx.api.toast.error(
        `Could not save the file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Crypto goes in K4 avsnitt D. Every sale, and every swap of one coin for another, is a
        disposal — the average cost is pooled per coin across every crypto account. Two rules
        differ from shares: schablonmetoden (the 20 % fallback) does not apply here, and a loss
        does not offset a gain in full. A +10 000 and a −10 000 in the same year still leave
        3 000 to be taxed, because only 70 % of the loss counts.
      </p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border p-4 sm:grid-cols-4">
        {summary.map(([label, value, hint], index) => (
          <div key={label} className={index === summary.length - 1 ? 'font-medium' : undefined}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`text-lg tabular-nums ${value < 0 ? 'text-destructive' : ''}`}>
              <Money value={value} currency={currency} />
            </div>
            {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
          </div>
        ))}
      </div>

      <Section
        title="Disposals"
        count={crypto.rows.length > 0 ? `${crypto.rows.length} in ${result.year}` : undefined}
        action={
          crypto.rows.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          ) : undefined
        }
        description={
          <>
            Every disposal in {result.year} — a sale, or a coin swapped for another coin. Each one
            is a K4 avsnitt D row; the cost basis is the pooled average for that coin.
          </>
        }
      >
        {crypto.rows.length === 0 ? (
          <EmptyState>
            Nothing was sold or swapped in {result.year} in an account marked{' '}
            <strong>Crypto</strong>.
          </EmptyState>
        ) : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead column="date" sort={sort} onToggle={toggle}>
                  Date
                </SortableHead>
                <SortableHead column="symbol" sort={sort} onToggle={toggle}>
                  Coin
                </SortableHead>
                <SortableHead column="account" sort={sort} onToggle={toggle}>
                  Account
                </SortableHead>
                <SortableHead column="quantity" sort={sort} onToggle={toggle} align="right">
                  Quantity
                </SortableHead>
                <SortableHead column="proceeds" sort={sort} onToggle={toggle} align="right">
                  Proceeds
                </SortableHead>
                <SortableHead column="cost" sort={sort} onToggle={toggle} align="right">
                  Cost basis
                </SortableHead>
                <SortableHead column="result" sort={sort} onToggle={toggle} align="right">
                  Result
                </SortableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row: K4Row, index) => (
                <TableRow key={`${row.date}-${row.symbol}-${index}`}>
                  <TableCell className="text-muted-foreground">{row.date}</TableCell>
                  <TableCell>
                    <span className="font-medium">{row.symbol}</span>
                    {row.note ? (
                      <Badge variant="warning" className="ml-2">
                        {row.note}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.account}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                  <TableCell className="text-right">
                    <Money value={row.forsaljningspris} currency={currency} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={row.omkostnadsbelopp} currency={currency} />
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${row.result < 0 ? 'text-destructive' : ''}`}
                  >
                    <Money value={row.result} currency={currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </>
        )}
      </Section>

      <Separator />

      <Section
        title="Staking, earn and airdrop rewards"
        count={crypto.rewardRows.length > 0 ? `${crypto.rewardRows.length} receipt(s)` : undefined}
        description={
          <>
            Coins that arrived without anything leaving to pay for them. Each is capital income at
            its value on the day it landed, and that same value becomes its omkostnadsbelopp — so
            it is not taxed a second time when you sell. Mined coins belong in inkomst av tjänst
            instead, and a pure airdrop you did nothing for is normally untaxed on arrival with an
            omkostnadsbelopp of 0; adjust those by hand.
          </>
        }
      >
        {crypto.rewardRows.length > 0 ? (
          <IncomeTable rows={crypto.rewardRows} currency={currency} unit="Coins" />
        ) : (
          <EmptyState>Nothing was received in {result.year}.</EmptyState>
        )}
      </Section>
    </div>
  );
}
