import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  formatAmount,
} from '@wealthfolio/ui';
import { useMemo } from 'react';
import { Money } from '../../components/money';
import { Section } from '../../components/section';
import { SortableHead, useTableSort } from '../../components/sortable-table';
import { EmptyState } from '../../components/table';
import type { IskAccountResult, TaxYearResult } from '../../lib/swedish-tax';

export function IskTab({ result, currency }: { result: TaxYearResult; currency: string }) {
  const quarters = ['1 Jan', '1 Apr', '1 Jul', '1 Oct'];

  const columns = useMemo(
    () => ({
      name: { value: (a: IskAccountResult) => a.name },
      deposits: { value: (a: IskAccountResult) => a.deposits, numeric: true },
      kapitalunderlag: { value: (a: IskAccountResult) => a.kapitalunderlag, numeric: true },
      fribelopp: { value: (a: IskAccountResult) => a.fribeloppShare, numeric: true },
      schablonintakt: { value: (a: IskAccountResult) => a.schablonintakt, numeric: true },
    }),
    [],
  );
  const {
    rows: accounts,
    sort,
    toggle,
  } = useTableSort(result.isk.accounts, columns, {
    key: 'kapitalunderlag',
    direction: 'desc',
  });

  if (result.isk.accounts.length === 0) {
    return (
      <EmptyState>No account is classified as an ISK yet. Use the Accounts tab.</EmptyState>
    );
  }

  const steps: Array<[string, string]> = [
    ['Kapitalunderlag', formatAmount(result.isk.kapitalunderlag, currency)],
    ['Fribelopp', `− ${formatAmount(result.isk.fribeloppApplied, currency)}`],
    ['Taxed on', formatAmount(result.isk.taxableUnderlag, currency)],
    ['Rate', `× ${(result.rate * 100).toFixed(2)} %`],
    ['Schablonintäkt', formatAmount(result.isk.schablonintakt, currency)],
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The kapitalunderlag is the average of the four quarter-start values plus everything
        deposited during the year — withdrawals do not reduce it. The rate is set from
        statslåneräntan on 30 November {result.year - 1}, and 30 % of the resulting
        schablonintäkt is the tax.
      </p>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 rounded-lg border p-4">
        {steps.map(([label, value], index) => (
          <div key={label} className={index === steps.length - 1 ? 'font-medium' : undefined}>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-lg tabular-nums">{value}</div>
          </div>
        ))}
        <p className="w-full text-xs text-muted-foreground">
          The fribelopp for {result.year} is {formatAmount(result.fribelopp, currency)} — one
          allowance for all your ISK accounts together, split below in proportion to each
          account&apos;s kapitalunderlag.
          {result.fribelopp > result.isk.kapitalunderlag
            ? ' Your combined underlag is smaller than the allowance, so none of it is taxed.'
            : null}
        </p>
      </div>

      <Section
        title="ISK accounts"
        count={`${result.isk.accounts.length} account(s)`}
        description={
          <>
            The kapitalunderlag each account contributed: its value at the four quarter starts
            plus the year&apos;s insättningar, divided by four.
          </>
        }
      >
        <Table>
        <TableHeader>
          <TableRow>
            <SortableHead column="name" sort={sort} onToggle={toggle}>
              Account
            </SortableHead>
            {quarters.map((q) => (
              <TableHead key={q} className="text-right">
                {q}
              </TableHead>
            ))}
            <SortableHead column="deposits" sort={sort} onToggle={toggle} align="right">
              Deposits
            </SortableHead>
            <SortableHead column="kapitalunderlag" sort={sort} onToggle={toggle} align="right">
              Kapitalunderlag
            </SortableHead>
            <SortableHead column="fribelopp" sort={sort} onToggle={toggle} align="right">
              Fribelopp
            </SortableHead>
            <SortableHead column="schablonintakt" sort={sort} onToggle={toggle} align="right">
              Schablonintäkt
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.accountId}>
              <TableCell className="font-medium">{account.name}</TableCell>
              {account.quarterValues.map((value, index) => (
                <TableCell key={index} className="text-right">
                  {value === null ? (
                    <span className="text-muted-foreground">no data</span>
                  ) : (
                    <span
                      className={
                        account.projectedQuarters.includes(index) ? 'text-muted-foreground' : ''
                      }
                    >
                      <Money value={value} currency={currency} />
                      {account.projectedQuarters.includes(index) ? ' *' : ''}
                    </span>
                  )}
                </TableCell>
              ))}
              <TableCell className="text-right">
                <Money value={account.deposits} currency={currency} />
              </TableCell>
              <TableCell className="text-right">
                <Money value={account.kapitalunderlag} currency={currency} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                −<Money value={account.fribeloppShare} currency={currency} />
              </TableCell>
              <TableCell className="text-right font-medium">
                <Money value={account.schablonintakt} currency={currency} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5}>Total</TableCell>
            <TableCell className="text-right">
              <Money
                value={result.isk.accounts.reduce((sum, a) => sum + a.deposits, 0)}
                currency={currency}
              />
            </TableCell>
            <TableCell className="text-right">
              <Money value={result.isk.kapitalunderlag} currency={currency} />
            </TableCell>
            <TableCell className="text-right">
              −<Money value={result.isk.fribeloppApplied} currency={currency} />
            </TableCell>
            <TableCell className="text-right">
              <Money value={result.isk.schablonintakt} currency={currency} />
            </TableCell>
          </TableRow>
        </TableFooter>
        </Table>
      </Section>
      <p className="text-xs text-muted-foreground">
        * quarter has not started yet — the latest known value is carried forward.
        {result.isk.withholding > 0 ? (
          <>
            {' '}
            Foreign withholding tax of <Money value={result.isk.withholding} currency={currency} />{' '}
            was deducted inside the ISK. Skatteverket credits it against the schablon tax
            automatically; it is not part of the figures above.
          </>
        ) : null}
      </p>
    </div>
  );
}
