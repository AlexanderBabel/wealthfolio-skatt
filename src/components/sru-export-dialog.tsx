import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@wealthfolio/ui';
import { Landmark } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  buildBlanketterSru,
  buildInfoSru,
  isValidPersonnummer,
  normalizePersonnummer,
  validateFiler,
  type FilerInfo,
} from '../lib/sru';
import { loadFilerInfo, saveFilerInfo } from '../lib/storage';
import { detailK4, summarizeK4, type TaxYearResult } from '../lib/swedish-tax';

const EMPTY_FILER: FilerInfo = { personnummer: '', name: '', postnr: '', postort: '' };

/**
 * Collects the four identity fields INFO.SRU's MEDIELEV block requires - none
 * of them part of Wealthfolio's own data - and saves them for next time, then
 * writes INFO.SRU and
 * BLANKETTER.SRU via the host's save dialog.
 */
export function SruExportDialog({
  ctx,
  result,
  detail,
  onDetailChange,
}: {
  ctx: AddonContext;
  result: TaxYearResult;
  /** True: one avsnitt D row per disposal. False: one per coin per year. */
  detail: boolean;
  onDetailChange: (detail: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filer, setFiler] = useState<FilerInfo>(EMPTY_FILER);
  const [errors, setErrors] = useState<string[]>([]);

  const year = result.year;
  const k4Summary = summarizeK4(result.depa.rows);
  const cryptoRows = detail ? detailK4(result.crypto.rows) : summarizeK4(result.crypto.rows);
  const nothingToFile = k4Summary.length === 0 && cryptoRows.length === 0;

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
          Export to Skatteverket
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export for Skatteverket</DialogTitle>
          <DialogDescription>
            K4 for {year}, written as INFO.SRU and BLANKETTER.SRU. Upload both to
            Skatteverket as separate files — not zipped.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5 rounded-lg border p-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span>
                Avsnitt A <span className="text-muted-foreground">listed shares and ETFs</span>
              </span>
              <span className="tabular-nums text-muted-foreground">{k4Summary.length} rows</span>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <span>
                Avsnitt D <span className="text-muted-foreground">crypto</span>
              </span>
              <span className="tabular-nums text-muted-foreground">{cryptoRows.length} rows</span>
            </div>
            {result.crypto.rows.length === 0 ? (
              <p className="pt-0.5 text-xs text-muted-foreground">
                Empty — mark your exchange accounts <strong>Crypto</strong> if that is wrong.
              </p>
            ) : null}
            {nothingToFile ? (
              <p className="pt-0.5 text-xs text-destructive">
                Nothing to report this year; the K4 would be blank.
              </p>
            ) : null}
          </div>

          {result.crypto.rows.length > 0 ? (
            <div className="space-y-1">
              <Label htmlFor="sru-detail">Crypto rows in avsnitt D</Label>
              <Select
                value={detail ? 'detail' : 'summary'}
                onValueChange={(value) => onDetailChange(value === 'detail')}
              >
                <SelectTrigger id="sru-detail">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="detail">One row per disposal</SelectItem>
                  <SelectItem value="summary">One row per coin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Skatteverket asks for one row per disposal. Per coin is the compact form.
              </p>
            </div>
          ) : null}

          <Separator />

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
            This is the addon&apos;s own estimate, <strong>not a declaration</strong> — check the figures
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
