import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Page,
  PageContent,
  PageHeader,
  Progress,
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
import { Download, Landmark, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  loadFilerInfo,
  saveFilerInfo,
  saveWrappers,
  useTaxData,
  useTaxYear,
  useWrappers,
  type LoadProgress,
  type WrapperMap,
} from '../hooks/use-tax-year';
import {
  buildBlanketterSru,
  buildInfoSru,
  isValidPersonnummer,
  normalizePersonnummer,
  validateFiler,
  type FilerInfo,
} from '../lib/sru';
import {
  detailK4,
  summarizeK4,
  type FundHoldingRow,
  type K4Row,
  type K4Summary,
  type TaxYearResult,
  type Warning,
  type Wrapper,
} from '../lib/swedish-tax';

const WRAPPER_LABELS: Record<Wrapper, string> = {
  ISK: 'ISK',
  DEPA: 'Depå',
  CRYPTO: 'Crypto',
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
  refund,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  refund?: boolean;
}) {
  return (
    <Card className={refund ? 'border-success/40 bg-success/5' : undefined}>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          {label}
          {refund ? <Badge variant="success">back to you</Badge> : null}
        </CardDescription>
        <CardTitle
          className={`tabular-nums ${emphasis ? 'text-3xl' : 'text-2xl'} ${
            refund ? 'text-success' : ''
          }`}
        >
          {refund ? `+ ${value}` : value}
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

/** Fund/ETF schablonintakt, one line per symbol held on 1 January. */
function FundHoldings({
  rows,
  year,
  currency,
}: {
  rows: FundHoldingRow[];
  year: number;
  currency: string;
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.valueSek - a.valueSek);

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Fund schablonintäkt</h4>
      <p className="text-xs text-muted-foreground">
        0.4 % of each fund or ETF&apos;s value on 1 January {year}, taxed as capital income —
        separate from any gain or loss on selling it.
      </p>
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

/** CSV, semicolon-separated and comma-decimal - Excel's Swedish default. */
function k4Csv(rows: K4Summary[]): string {
  const num = (n: number) => String(n).replace('.', ',');
  const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [
    ['Beteckning', 'Antal', 'Försäljningspris', 'Omkostnadsbelopp', 'Vinst', 'Förlust'].join(';'),
    ...rows.map((r) =>
      [
        cell(r.name ? `${r.symbol} - ${r.name}` : r.symbol),
        num(r.quantity),
        num(r.forsaljningspris),
        num(r.omkostnadsbelopp),
        num(r.vinst),
        num(r.forlust),
      ].join(';'),
    ),
  ];
  return lines.join('\r\n');
}

const EMPTY_FILER: FilerInfo = { personnummer: '', name: '', postnr: '', postort: '' };

/**
 * Collects the four identity fields INFO.SRU's MEDIELEV block requires - none
 * of them part of Wealthfolio's own data - and saves them for next time, then
 * writes INFO.SRU and
 * BLANKETTER.SRU via the host's save dialog.
 */
function SruExportDialog({
  ctx,
  k4Summary,
  cryptoRows,
  year,
}: {
  ctx: AddonContext;
  k4Summary: K4Summary[];
  /** Avsnitt D. Rides along on the same blanketter as avsnitt A. */
  cryptoRows: K4Summary[];
  year: number;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filer, setFiler] = useState<FilerInfo>(EMPTY_FILER);
  const [errors, setErrors] = useState<string[]>([]);

  const { data: saved } = useQuery({
    queryKey: ['skatt', 'filer'],
    queryFn: () => loadFilerInfo(ctx),
    enabled: open,
  });
  useEffect(() => {
    if (saved) setFiler(saved);
  }, [saved]);

  // Two independent mutations, not one that awaits both dialogs in a row: the
  // host's native save dialog is one-per-click in practice, so chaining a
  // second call onto the same click silently never opens - each file gets
  // its own button and its own fresh click.
  const saveInfo = useMutation({
    mutationFn: async (next: FilerInfo) => {
      await saveFilerInfo(ctx, next);
      await ctx.api.files.openSaveDialog(buildInfoSru(next), 'INFO.SRU');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skatt', 'filer'] });
      ctx.api.toast.success('Saved INFO.SRU.');
    },
    onError: (error: unknown) =>
      ctx.api.toast.error(
        `Could not save INFO.SRU: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });

  const saveBlanketter = useMutation({
    mutationFn: async (next: FilerInfo) => {
      await saveFilerInfo(ctx, next);
      // The exact name BLANKETTER.SRU matters - Skatteverket's service
      // rejects a renamed duplicate such as "blanketter (1).sru".
      await ctx.api.files.openSaveDialog(
        buildBlanketterSru(k4Summary, next, year, new Date(), cryptoRows),
        'BLANKETTER.SRU',
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skatt', 'filer'] });
      ctx.api.toast.success('Saved BLANKETTER.SRU.');
    },
    onError: (error: unknown) =>
      ctx.api.toast.error(
        `Could not save BLANKETTER.SRU: ${error instanceof Error ? error.message : String(error)}`,
      ),
  });

  const set = (patch: Partial<FilerInfo>) => setFiler((f) => ({ ...f, ...patch }));

  const withValidFiler = (run: (filer: FilerInfo) => void) => {
    const normalized = { ...filer, personnummer: normalizePersonnummer(filer.personnummer) };
    const validationErrors = validateFiler(normalized);
    setErrors(validationErrors);
    if (validationErrors.length === 0) run(normalized);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Landmark className="mr-2 h-4 w-4" />
          Export SRU (Skatteverket)
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export for Skatteverket</DialogTitle>
          <DialogDescription>
            Generates INFO.SRU and BLANKETTER.SRU for K4 avsnitt A{cryptoRows.length > 0 ? ' and avsnitt D (crypto)' : ''}. Skatteverket&apos;s e-service
            wants the two files uploaded separately, not zipped together, with those exact names —
            save them to the same folder and upload both. Saved here so this only has to be typed
            once.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sru-pnr">Personnummer</Label>
            <Input
              id="sru-pnr"
              placeholder="ÅÅÅÅMMDDXXXX"
              value={filer.personnummer}
              onChange={(e) => set({ personnummer: e.target.value })}
            />
            {filer.personnummer && !isValidPersonnummer(normalizePersonnummer(filer.personnummer)) ? (
              <p className="text-xs text-muted-foreground">12 digits, no dashes.</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="sru-name">Name</Label>
            <Input id="sru-name" value={filer.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sru-postnr">Postnummer</Label>
              <Input
                id="sru-postnr"
                value={filer.postnr}
                onChange={(e) => set({ postnr: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sru-postort">Postort</Label>
              <Input
                id="sru-postort"
                value={filer.postort}
                onChange={(e) => set({ postort: e.target.value })}
              />
            </div>
          </div>

          {errors.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Avsnitt A only, {k4Summary.length} security line{k4Summary.length === 1 ? '' : 's'} for{' '}
            {year}. This is the addon&apos;s own estimate, not a declaration — check the figures
            against your broker before uploading.
          </p>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            className="w-full"
            variant="outline"
            onClick={() => withValidFiler((f) => saveInfo.mutate(f))}
            disabled={saveInfo.isPending}
          >
            1. Save INFO.SRU
          </Button>
          <Button
            className="w-full"
            onClick={() => withValidFiler((f) => saveBlanketter.mutate(f))}
            disabled={saveBlanketter.isPending}
          >
            2. Save BLANKETTER.SRU
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DepaTab({
  ctx,
  result,
  currency,
  cryptoDetail,
}: {
  ctx: AddonContext;
  result: TaxYearResult;
  currency: string;
  /** Only to keep the SRU written here identical to the one written on the Crypto tab. */
  cryptoDetail: boolean;
}) {
  const { depa } = result;
  const schablonWins = depa.rows.filter((r) => r.schablonBetter);
  const k4Summary = summarizeK4(depa.rows);
  const cryptoRows = cryptoDetail ? detailK4(result.crypto.rows) : summarizeK4(result.crypto.rows);

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

      {depa.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No disposals in {result.year} from an account classified as Depå.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Every disposal in {result.year} — a sale, or a transfer into an ISK — with the
              försäljningspris, omkostnadsbelopp and result (vinst/förlust) it produced under
              genomsnittsmetoden.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={exportK4}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <SruExportDialog
                ctx={ctx}
                k4Summary={k4Summary}
                cryptoRows={cryptoRows}
                year={result.year}
              />
            </div>
          </div>
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
        </div>
      )}

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

/**
 * K4 avsnitt D. Crypto is an "annan tillgang", not a delagarratt, so three
 * things differ from the Depa tab: its own average-cost pool per coin, no
 * schablonmetoden, and losses that count at 70 % without netting against
 * gains first.
 */
function CryptoTab({
  ctx,
  result,
  currency,
  detail,
  onDetailChange,
}: {
  ctx: AddonContext;
  result: TaxYearResult;
  currency: string;
  /** True: one K4 row per disposal. False: one per coin per year. */
  detail: boolean;
  onDetailChange: (detail: boolean) => void;
}) {
  const { crypto, depa } = result;
  const k4Summary = summarizeK4(depa.rows);
  const cryptoRows = detail ? detailK4(crypto.rows) : summarizeK4(crypto.rows);

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

      {crypto.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No crypto disposals in {result.year} from an account classified as Crypto.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Every disposal in {result.year} — a sale, or a coin swapped for another coin.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Select
                value={detail ? 'detail' : 'summary'}
                onValueChange={(value) => onDetailChange(value === 'detail')}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="detail">One K4 row per disposal</SelectItem>
                  <SelectItem value="summary">One K4 row per coin</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <SruExportDialog
                ctx={ctx}
                k4Summary={k4Summary}
                cryptoRows={cryptoRows}
                year={result.year}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Skatteverket asks for one row per disposal for crypto; one row per coin is the
            compact form. The choice applies to the CSV and to avsnitt D in the SRU export.
            {cryptoRows.length} row(s) either way will be written.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Coin</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Proceeds</TableHead>
                <TableHead className="text-right">Cost basis</TableHead>
                <TableHead className="text-right">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crypto.rows.map((row: K4Row, index) => (
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
        </div>
      )}
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
    // Write the new map into the cheap query before awaiting anything, so the
    // dropdown moves on click. Re-reading the portfolio is what actually takes
    // the time, and it is left to run behind the control rather than in front
    // of it. Changing several accounts in a row is the normal case, so an
    // in-flight read of the old map must not land on top of a newer choice.
    onMutate: async (next: WrapperMap) => {
      await queryClient.cancelQueries({ queryKey: ['skatt', 'wrappers'] });
      const previous = queryClient.getQueryData<WrapperMap>(['skatt', 'wrappers']);
      queryClient.setQueryData(['skatt', 'wrappers'], next);
      return { previous };
    },
    onError: (error: unknown, _next, context) => {
      if (context?.previous) queryClient.setQueryData(['skatt', 'wrappers'], context.previous);
      ctx.api.toast.error(
        `Could not save the account classification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skatt', 'data'] }),
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
    <AccountsTab ctx={ctx} wrappers={wrappers ?? {}} accounts={data?.accounts ?? []} />
  );

  return (
    <Page>
      <PageHeader
        heading="Skatt"
        text="Swedish capital income tax on ISK and depå accounts — an estimate, not a declaration."
        actions={
          <div className="flex items-center gap-2">
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
                <DepaTab
                  ctx={ctx}
                  result={view.result}
                  currency={currency}
                  cryptoDetail={cryptoDetail}
                />
              </TabsContent>
              <TabsContent value="crypto" className="pt-4">
                <CryptoTab
                  ctx={ctx}
                  result={view.result}
                  currency={currency}
                  detail={cryptoDetail}
                  onDetailChange={setCryptoDetail}
                />
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
