import { formatAmount } from '@wealthfolio/ui';

/** Every monetary figure on the page, so alignment and formatting stay in one place. */
export function Money({ value, currency }: { value: number; currency: string }) {
  return <span className="tabular-nums">{formatAmount(value, currency)}</span>;
}
