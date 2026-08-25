import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@wealthfolio/ui';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * A titled, collapsible block: what the table below is, and what it is for.
 *
 * Every table on the page sits in one, so a figure is never presented without
 * saying where it came from, and a year with a lot in it can be folded down to
 * its headings. The action slot sits outside the trigger on purpose - an
 * export button inside it would toggle the section on every click.
 */
export function Section({
  title,
  count,
  description,
  action,
  defaultOpen = true,
  children,
}: {
  title: string;
  /** Shown next to the title, e.g. "12 rows". */
  count?: string;
  description?: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <CollapsibleTrigger className="flex flex-1 items-start gap-2 text-left">
          <ChevronRight
            aria-hidden
            className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          />
          <div className="space-y-1">
            <h4 className="text-base font-semibold tracking-tight">
              {title}
              {count ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">{count}</span>
              ) : null}
            </h4>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </CollapsibleTrigger>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
