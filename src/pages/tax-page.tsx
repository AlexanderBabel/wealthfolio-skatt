import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Page,
  PageContent,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatAmount,
} from '@wealthfolio/ui';
import { useRef, useState } from 'react';
import { saveWrappers, useTaxData, useTaxYear, type WrapperMap } from '../hooks/use-tax-year';
import type { K4Row, TaxYearResult, Warning, Wrapper } from '../lib/swedish-tax';

const WRAPPER_LABELS: Record<Wrapper, string> = {
  ISK: 'ISK',
  DEPA: 'Depå',
  IGNORE: 'Not taxed here',
};

function Money({ value, currency }: { value: number; currency: string }) {
  return <span className="tabular-nums">{formatAmount(value, currency)}</span>;
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={emphasis ? 'text-3xl tabular-nums' : 'text-2xl tabular-nums'}>
          {value}
        </CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>
      ) : null}
    </Card>
  );
}

/**
 * A year can raise a hundred warnings and they are nearly all the same handful
 * of things repeated, so only the categories are shown until asked.
 */
function Warnings({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;

  const groups = new Map<string, string[]>();
  for (const warning of warnings) {
    groups.set(warning.category, [...(groups.get(warning.category) ?? []), warning.detail]);
  }

  return (
    <Alert variant="warning">
      <AlertTitle>Worth checking</AlertTitle>
      <AlertDescription>
        <div className="space-y-1">
          {[...groups].map(([category, details]) => (
            <details key={category}>
              <summary className="cursor-pointer">
                {category} <span className="text-muted-foreground">({details.length})</span>
              </summary>
              <ul className="list-disc space-y-1 py-1 pl-6 text-muted-foreground">
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function IskTab({ result, currency }: { result: TaxYearResult; currency: string }) {
  const quarters = ['1 Jan', '1 Apr', '1 Jul', '1 Oct'];

  if (result.isk.accounts.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No account is classified as an ISK yet. Use the Accounts tab.
      </p>
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
        deposited during the year — withdrawals do not reduce it. The rate is statslåneräntan on
        30 November {result.year - 1} plus one percentage point, and 30 % of the resulting
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            {quarters.map((q) => (
              <TableHead key={q} className="text-right">
                {q}
              </TableHead>
            ))}
            <TableHead className="text-right">Deposits</TableHead>
            <TableHead className="text-right">Kapitalunderlag</TableHead>
            <TableHead className="text-right">Fribelopp</TableHead>
            <TableHead className="text-right">Schablonintäkt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.isk.accounts.map((account) => (
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

function DepaTab({ result, currency }: { result: TaxYearResult; currency: string }) {
  const { depa } = result;
  const schablonWins = depa.rows.filter((r) => r.schablonBetter);

  const summary: Array<[string, number, string?]> = [
    ['Gains', depa.gains],
    ['Losses', -depa.losses],
    ['Net', depa.netResult, depa.netResult < 0 ? 'counted at 70 %' : undefined],
    ['Dividends', depa.dividends, 'as imported — net of withholding tax'],
    ['Interest', depa.interest],
    ['Fees', depa.fees, 'förvaltningsutgifter, not deductible'],
  ];

  return (
    <div className="space-y-4">
      {depa.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No disposals in {result.year} from an account classified as Depå.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Security</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Försäljningspris</TableHead>
              <TableHead className="text-right">Omkostnadsbelopp</TableHead>
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
      )}

      <Separator />

      <dl className="grid gap-2 sm:grid-cols-2">
        {summary.map(([label, value, hint]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">
              {label}
              {hint ? <span className="ml-2 text-xs">({hint})</span> : null}
            </dt>
            <dd>
              <Money value={value} currency={currency} />
            </dd>
          </div>
        ))}
      </dl>

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

function AccountsTab({
  ctx,
  wrappers,
  accounts,
}: {
  ctx: AddonContext;
  wrappers: WrapperMap;
  accounts: Array<{ id: string; name: string; currency: string }>;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: WrapperMap) => saveWrappers(ctx, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skatt', 'data'] }),
    onError: (error: unknown) =>
      ctx.api.toast.error(
        `Could not save the account classification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Wealthfolio has no ISK account type, so the wrapper has to be set here. Anything left as
        “Not taxed here” is excluded from every figure on this page.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead className="w-56">Tax wrapper</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.id}>
              <TableCell className="font-medium">{account.name}</TableCell>
              <TableCell className="text-muted-foreground">{account.currency}</TableCell>
              <TableCell>
                <Select
                  value={wrappers[account.id] ?? 'IGNORE'}
                  onValueChange={(value) =>
                    mutation.mutate({ ...wrappers, [account.id]: value as Wrapper })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WRAPPER_LABELS) as Wrapper[]).map((wrapper) => (
                      <SelectItem key={wrapper} value={wrapper}>
                        {WRAPPER_LABELS[wrapper]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TaxPage({ ctx }: { ctx: AddonContext }) {
  const { data, isLoading, error } = useTaxData(ctx);
  const [year, setYear] = useState<number | null>(null);
  const selectedYear = year ?? data?.years[0] ?? new Date().getFullYear();
  const view = useTaxYear(data, selectedYear);
  const currency = data?.baseCurrency ?? 'SEK';

  const payable = view.result ? view.result.tax > 0 : false;
  // Nothing on this page means anything until the accounts are classified, so
  // that is the first thing shown. Setting one account must not throw you out
  // of the screen mid-way, so leaving is an explicit click.
  const noneClassified = !!data && !Object.values(data.wrappers).some((w) => w !== 'IGNORE');
  const [dismissed, setDismissed] = useState(false);
  const startedEmpty = useRef(false);
  if (noneClassified) startedEmpty.current = true;
  const showOnboarding = !dismissed && (noneClassified || startedEmpty.current);
  const accountsTab = (
    <AccountsTab ctx={ctx} wrappers={data?.wrappers ?? {}} accounts={data?.accounts ?? []} />
  );

  return (
    <Page>
      <PageHeader
        heading="Skatt"
        text="Swedish capital income tax on ISK and depå accounts — an estimate, not a declaration."
        actions={
          <Select
            value={String(selectedYear)}
            onValueChange={(value) => setYear(Number(value))}
            disabled={!data}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(data?.years ?? [selectedYear]).map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <PageContent>
        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <div className="space-y-6">
            <Alert variant="destructive">
              <AlertTitle>Could not read your portfolio</AlertTitle>
              <AlertDescription>
                {error instanceof Error ? error.message : String(error)}
              </AlertDescription>
            </Alert>
            {accountsTab}
          </div>
        ) : showOnboarding ? (
          <div className="space-y-6">
            <Alert>
              <AlertTitle>Start by telling the addon which account is which</AlertTitle>
              <AlertDescription>
                Wealthfolio has no ISK account type, so it cannot know how each of your accounts
                is taxed. Set a wrapper for every account — <strong>ISK</strong> for an
                investeringssparkonto, <strong>Depå</strong> for an ordinary taxable account — then
                continue.
              </AlertDescription>
            </Alert>
            {accountsTab}
            <div className="flex justify-end">
              <Button onClick={() => setDismissed(true)} disabled={noneClassified}>
                Continue to {selectedYear}
              </Button>
            </div>
          </div>
        ) : view.error ? (
          <Alert variant="destructive">
            <AlertTitle>No rate configured for {selectedYear}</AlertTitle>
            <AlertDescription>{view.error}</AlertDescription>
          </Alert>
        ) : view.result ? (
          <div className="space-y-6">
            {view.partial ? (
              <Alert>
                <AlertTitle>{selectedYear} is still running</AlertTitle>
                <AlertDescription>
                  Quarter starts that have not happened yet are filled with the latest known value,
                  and only the transactions recorded so far are counted. The figure will move.
                </AlertDescription>
              </Alert>
            ) : null}

            {view.baseCurrencyWarning ? (
              <Alert variant="destructive">
                <AlertTitle>Base currency is not SEK</AlertTitle>
                <AlertDescription>{view.baseCurrencyWarning}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label={payable ? 'Estimated tax' : 'Estimated tax reduction'}
                value={formatAmount(payable ? view.result.tax : view.result.taxReduction, currency)}
                hint={payable ? '30 % of the capital surplus' : 'from a capital deficit'}
                emphasis
              />
              <Stat
                label="Schablonintäkt (ISK)"
                value={formatAmount(view.result.isk.schablonintakt, currency)}
                hint={`${(view.result.rate * 100).toFixed(2)} % of the taxable kapitalunderlag`}
              />
              <Stat
                label="Depå result"
                value={formatAmount(view.result.depa.deductibleResult, currency)}
                hint={
                  view.result.depa.netResult < 0
                    ? 'net loss, quoted to 70 %'
                    : 'realised gains after offsetting losses'
                }
              />
              <Stat
                label="Kapitalöverskott"
                value={formatAmount(view.result.kapitalOverskott, currency)}
                hint="schablonintäkt + depå result + dividends + interest"
              />
            </div>

            <Warnings warnings={view.result.warnings} />

            <Tabs defaultValue="isk">
              <TabsList>
                <TabsTrigger value="isk">ISK</TabsTrigger>
                <TabsTrigger value="depa">Depå</TabsTrigger>
                <TabsTrigger value="accounts">Accounts</TabsTrigger>
              </TabsList>
              <TabsContent value="isk" className="pt-4">
                <IskTab result={view.result} currency={currency} />
              </TabsContent>
              <TabsContent value="depa" className="pt-4">
                <DepaTab result={view.result} currency={currency} />
              </TabsContent>
              <TabsContent value="accounts" className="pt-4">
                {accountsTab}
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </PageContent>
    </Page>
  );
}
