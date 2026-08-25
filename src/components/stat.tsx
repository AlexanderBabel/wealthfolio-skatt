import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@wealthfolio/ui';

/** One headline figure from the year, with the reasoning underneath it. */
export function Stat({
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

/** The same card as <Stat>, at the same height, while the figure is being re-read. */
export function StatSkeleton({ emphasis }: { emphasis?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>
          <Skeleton className="h-4 w-28" />
        </CardDescription>
        <CardTitle>
          <Skeleton className={emphasis ? 'h-9 w-40' : 'h-8 w-32'} />
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Skeleton className="h-3 w-44" />
      </CardContent>
    </Card>
  );
}
