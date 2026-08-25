import type { K4Summary } from './swedish-tax';

/** CSV, semicolon-separated and comma-decimal - Excel's Swedish default. */
export function k4Csv(rows: K4Summary[]): string {
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
