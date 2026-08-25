import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AddonContext } from '@wealthfolio/addon-sdk';
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Section } from '../../components/section';
import { saveWrappers, type WrapperMap } from '../../lib/storage';
import type { Wrapper } from '../../lib/swedish-tax';
import { WRAPPER_LABELS } from '../wrapper-labels';

export function AccountsTab({
  ctx,
  wrappers,
  accounts,
  isFetching,
}: {
  ctx: AddonContext;
  wrappers: WrapperMap;
  accounts: Array<{ id: string; name: string; currency: string }>;
  isFetching: boolean;
}) {
  const queryClient = useQueryClient();
  // Edits are staged rather than saved on every change. Classifying eight
  // accounts used to mean eight full portfolio re-reads, each one overtaking
  // the last and dragging the progress bar backwards. Null means nothing is
  // pending, so an external change still shows through.
  const [draft, setDraft] = useState<WrapperMap | null>(null);
  const current = draft ?? wrappers;

  const wrapperOf = (map: WrapperMap, id: string): Wrapper => map[id] ?? 'IGNORE';
  const changed = accounts.filter(
    (a) => wrapperOf(current, a.id) !== wrapperOf(wrappers, a.id),
  );

  const mutation = useMutation({
    mutationFn: async (next: WrapperMap) => {
      await saveWrappers(ctx, next);
      return next;
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(['skatt', 'wrappers'], next);
      setDraft(null);
      // Stop whatever read is already running before starting the replacement,
      // so only one of them is reporting progress.
      await queryClient.cancelQueries({ queryKey: ['skatt', 'data'] });
      queryClient.invalidateQueries({ queryKey: ['skatt', 'data'] });
    },
    onError: (error: unknown) =>
      ctx.api.toast.error(
        `Could not save the account classification: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
  });

  return (
    <div className="space-y-4">
      <Section
        title="Accounts"
        count={`${accounts.length}`}
        description={
          <>
            Wealthfolio has no ISK account type, so the wrapper has to be set here. Anything left
            as “Not taxed here” is excluded from every figure on this page. Changes are applied
            when you save, so you can set several at once and re-read the portfolio only once.
          </>
        }
      >
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead className="w-56">Tax wrapper</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => {
            const isChanged = wrapperOf(current, account.id) !== wrapperOf(wrappers, account.id);
            return (
              <TableRow key={account.id}>
                <TableCell className="font-medium">
                  {account.name}
                  {isChanged ? (
                    <Badge variant="info" className="ml-2">
                      unsaved
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{account.currency}</TableCell>
                <TableCell>
                  <Select
                    value={wrapperOf(current, account.id)}
                    onValueChange={(value) =>
                      setDraft({ ...current, [account.id]: value as Wrapper })
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
            );
          })}
        </TableBody>
        </Table>
      </Section>

      {changed.length > 0 ? (
        <div className="sticky bottom-0 flex items-center justify-between gap-4 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          <div className="text-sm">
            <span className="font-medium">
              {changed.length} account{changed.length === 1 ? '' : 's'} changed
            </span>
            <span className="text-muted-foreground">
              {' '}
              — the figures on the other tabs still reflect the saved settings.
            </span>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft(null)}
              disabled={mutation.isPending}
            >
              Discard
            </Button>
            <Button size="sm" onClick={() => mutation.mutate(current)} disabled={mutation.isPending}>
              <RefreshCw
                className={`mr-2 h-4 w-4 ${mutation.isPending ? 'animate-spin' : ''}`}
              />
              Save and re-read portfolio
            </Button>
          </div>
        </div>
      ) : isFetching ? (
        <p className="text-sm text-muted-foreground">
          Re-reading your portfolio — the figures on the other tabs are updating.
        </p>
      ) : null}
    </div>
  );
}
