import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import { Download } from 'lucide-react';
import { Money } from '../../components/money';
import { EmptyState, IncomeTable, SectionHeading } from '../../components/table';
import { k4Csv } from '../../lib/csv';
import { summarizeK4, type K4Row, type TaxYearResult } from '../../lib/swedish-tax';
import { FundHoldings } from './fund-holdings';

export function DepaTab({
  ctx,
  result,
  currency,
}: {
  ctx: AddonContext;
  result: TaxYearResult;
  currency: string;
}) {
  const { depa } = result;
  const schablonWins = depa.rows.filter((r) => r.schablonBetter);
  const k4Summary = summarizeK4(depa.rows);

  const totalCapitalIncome =
    depa.deductibleResult + depa.dividends + depa.interest + depa.fundSchablonintakt;

  const summary: Array<[string, number, string?]> = [
    ['Gains', depa.gains],
    ['Losses', -depa.losses],
    ['Net', depa.netResult, depa.netResult < 0 ? 'counted at 70 %' : undefined],
    ['Dividends', depa.dividends, 'as imported — net of withholding tax'],
    ['Interest', depa.interest],
    ['Fees', depa.fees, 'not deductible — förvaltningsutgifter'],
    ['Fund schablonintäkt', depa.fundSchablonintakt, 'see the table below'],
    ['Total capital income', totalCapitalIncome],
  ];

  const exportK4 = async () => {
    try {
      await ctx.api.files.openSaveDialog(k4Csv(k4Summary), `K4-${result.year}.csv`);
    } catch (error) {
      ctx.api.toast.error(
        `Could not save the file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every sale, and every transfer of securities out of a depå into an ISK, is a disposal.
        The gain uses genomsnittsmetoden — the pooled average cost of everything you have ever
        held in that security across every depå account, not just what you bought this year.
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

      <div className="space-y-2">
        <SectionHeading
          title="Disposals"
          count={depa.rows.length > 0 ? `${depa.rows.length} in ${result.year}` : undefined}
          action={
            depa.rows.length > 0 ? (
              <Button variant="outline" size="sm" onClick={exportK4}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            ) : undefined
          }
        >
          Every disposal in {result.year} — a sale, or a transfer into an ISK — with the
          försäljningspris, omkostnadsbelopp and result (vinst/förlust) it produced under
          genomsnittsmetoden.
        </SectionHeading>
        {depa.rows.length === 0 ? (
          <EmptyState>
            Nothing was sold in {result.year} in an account marked <strong>Depå</strong>.
          </EmptyState>
        ) : (
          <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Security</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Proceeds</TableHead>
                <TableHead className="text-right">Cost basis</TableHead>
                <TableHead className="text-right">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {depa.rows.map((row: K4Row, index) => (
                <TableRow key={`${row.date}-${row.symbol}-${index}`}>
                  <TableCell className="text-muted-foreground">{row.date}</TableCell>
                  <TableCell>
                    <span className="font-medium">{row.symbol}</span>
                    {row.note ? (
                      <Badge variant="warning" className="ml-2">
                        {row.note}
                      </Badge>
                    ) : null}
                    {row.schablonBetter ? (
                      <Badge variant="info" className="ml-2">
                        schablonmetoden is better
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
      </div>

      <Separator />

      <div className="space-y-2">
        <SectionHeading
          title="Dividends and interest"
          count={depa.incomeRows.length > 0 ? `${depa.incomeRows.length} payment(s)` : undefined}
        >
          Capital income in its own right, taxed at 30 % whatever the disposals did. Amounts are
          as imported — if your broker books dividends net of withholding tax, that is what is
          shown here, and INK1 7.2 wants the gross figure.
        </SectionHeading>
        {depa.incomeRows.length > 0 ? (
          <IncomeTable rows={depa.incomeRows} currency={currency} />
        ) : (
          <EmptyState>No dividends or interest received in {result.year}.</EmptyState>
        )}
      </div>

      <Separator />

      <FundHoldings rows={depa.fundHoldings} year={result.year} currency={currency} />

      {schablonWins.length > 0 ? (
        <Alert>
          <AlertTitle>Schablonmetoden would lower the gain on {schablonWins.length} sale(s)</AlertTitle>
          <AlertDescription>
            For listed shares you may use 20 % of the proceeds as omkostnadsbelopp instead of the
            average cost. The figures above use the average cost throughout.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
