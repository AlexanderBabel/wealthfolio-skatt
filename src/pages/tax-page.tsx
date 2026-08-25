import { useQueryClient } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Page,
  PageContent,
  PageHeader,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatAmount,
} from '@wealthfolio/ui';
import { RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { SruExportDialog } from '../components/sru-export-dialog';
import { Stat, StatSkeleton } from '../components/stat';
import { Warnings } from '../components/warnings';
import { useTaxData, useWrappers, type LoadProgress } from '../hooks/use-tax-data';
import { useTaxYear } from '../hooks/use-tax-year';
import { AccountsTab } from './tabs/accounts-tab';
import { CryptoTab } from './tabs/crypto-tab';
import { DepaTab } from './tabs/depa-tab';
import { IskTab } from './tabs/isk-tab';

export function TaxPage({ ctx }: { ctx: AddonContext }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<LoadProgress>({ fraction: 0, label: 'Loading…' });
  const { data, isLoading, isFetching, error } = useTaxData(ctx, setProgress);
  // Read separately from the portfolio query so classifying an account is
  // instant; `data` catches up in the background.
  const { data: wrappers } = useWrappers(ctx);
  const [year, setYear] = useState<number | null>(null);
  const selectedYear = year ?? data?.years[0] ?? new Date().getFullYear();
  const view = useTaxYear(data, selectedYear);
  const currency = data?.baseCurrency ?? 'SEK';

  const payable = view.result ? view.result.tax > 0 : false;
  // A re-read after classifying an account keeps the old figures on screen,
  // which look settled while they are actually about to change. During one,
  // the cards go blank and the same progress bar as the first load comes back.
  const refreshing = isFetching && !isLoading;
  // Nothing on this page means anything until the accounts are classified, so
  // that is the first thing shown. Setting one account must not throw you out
  // of the screen mid-way, so leaving is an explicit click.
  const noneClassified = !!wrappers && !Object.values(wrappers).some((w) => w !== 'IGNORE');
  const [dismissed, setDismissed] = useState(false);
  // Lives here, not in CryptoTab: the SRU export is offered on both tabs and
  // has to write the same avsnitt D either way.
  const [cryptoDetail, setCryptoDetail] = useState(true);
  const startedEmpty = useRef(false);
  if (noneClassified) startedEmpty.current = true;
  const showOnboarding = !dismissed && (noneClassified || startedEmpty.current);
  const accountsTab = (
    <AccountsTab
      ctx={ctx}
      wrappers={wrappers ?? {}}
      accounts={data?.accounts ?? []}
      isFetching={isFetching}
    />
  );

  return (
    <Page>
      <PageHeader
        heading="Skatt"
        text="Swedish capital income tax overview"
        actions={
          <div className="flex items-center gap-2">
            {view.result ? (
              <SruExportDialog
                ctx={ctx}
                result={view.result}
                detail={cryptoDetail}
                onDetailChange={setCryptoDetail}
              />
            ) : null}
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
            <Button
              variant="outline"
              size="icon"
              title="Re-read your portfolio — figures are cached for a few minutes otherwise"
              disabled={isFetching}
              onClick={() => queryClient.invalidateQueries({ queryKey: ['skatt', 'data'] })}
            >
              <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            </Button>
          </div>
        }
      />
      <PageContent>
        {isLoading ? (
          <div className="mx-auto max-w-sm space-y-3 py-16">
            <Progress value={progress.fraction * 100} />
            <p className="text-center text-sm text-muted-foreground">{progress.label}</p>
          </div>
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

            {refreshing ? (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium">Re-reading your portfolio…</span>
                  <span className="text-muted-foreground">{progress.label}</span>
                </div>
                <Progress value={progress.fraction * 100} />
              </div>
            ) : null}

            {refreshing ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatSkeleton emphasis />
                <StatSkeleton />
                <StatSkeleton />
                <StatSkeleton />
              </div>
            ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label={payable ? 'Estimated tax to pay' : 'Estimated tax reduction'}
                value={formatAmount(payable ? view.result.tax : view.result.taxReduction, currency)}
                hint={
                  payable
                    ? '30 % of the capital surplus'
                    : 'the year is a capital deficit, so this comes off your tax instead'
                }
                emphasis
                refund={!payable && view.result.taxReduction > 0}
              />
              <Stat
                label={`Schablonintäkt at ${(view.result.rate * 100).toFixed(2)} %`}
                value={formatAmount(view.result.isk.schablonintakt, currency)}
                hint={`ISK, on a kapitalunderlag of ${formatAmount(
                  view.result.isk.taxableUnderlag,
                  currency,
                )}`}
              />
              <Stat
                label="Fribelopp used"
                value={`${formatAmount(view.result.isk.fribeloppApplied, currency)} of ${formatAmount(
                  view.result.fribelopp,
                  currency,
                )}`}
                hint={
                  view.result.fribelopp === 0
                    ? `No allowance existed in ${view.result.year}`
                    : `One allowance for ${view.result.year}, shared by every ISK`
                }
              />
              <Stat
                label="Capital surplus"
                value={formatAmount(view.result.kapitalOverskott, currency)}
                hint="ISK + fund schablonintäkt, depå result, dividends, interest"
              />
            </div>
            )}

            <Warnings warnings={view.result.warnings} />

            <Tabs defaultValue="isk">
              <TabsList>
                <TabsTrigger value="isk">ISK</TabsTrigger>
                <TabsTrigger value="depa">Depå</TabsTrigger>
                <TabsTrigger value="crypto">Crypto</TabsTrigger>
                <TabsTrigger value="accounts">Accounts</TabsTrigger>
              </TabsList>
              <TabsContent value="isk" className="pt-4">
                <IskTab result={view.result} currency={currency} />
              </TabsContent>
              <TabsContent value="depa" className="pt-4">
                <DepaTab ctx={ctx} result={view.result} currency={currency} />
              </TabsContent>
              <TabsContent value="crypto" className="pt-4">
                <CryptoTab ctx={ctx} result={view.result} currency={currency} />
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
