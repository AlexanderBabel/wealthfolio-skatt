import { Alert, AlertDescription, AlertTitle } from '@wealthfolio/ui';
import type { Warning } from '../lib/swedish-tax';

/**
 * A year can raise a hundred warnings and they are nearly all the same handful
 * of things repeated, so only the categories are shown until asked.
 */
export function Warnings({ warnings }: { warnings: Warning[] }) {
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
