import type { ExchangeRate, Quote } from '@wealthfolio/addon-sdk';
import { describe, expect, it } from 'vitest';
import { today } from '../lib/dates';
import { buildRates } from './use-tax-data';

const pair = (fromCurrency: string, toCurrency: string, rate: number, closes: [string, number][]) => ({
  r: { id: `${fromCurrency}${toCurrency}`, fromCurrency, toCurrency, rate } as ExchangeRate,
  history: closes.map(([timestamp, close]) => ({ timestamp, close }) as Quote),
});

describe('buildRates', () => {
  it('keeps the direct pair over its rounded inverse, whichever arrives first', () => {
    const direct = pair('EUR', 'SEK', 0, [['2024-01-02', 11.296]]);
    const inverse = pair('SEK', 'EUR', 0, [['2024-01-02', 0.08801]]);
    expect(buildRates([direct, inverse], 'SEK').EUR[0].rate).toBe(11.296);
    expect(buildRates([inverse, direct], 'SEK').EUR[0].rate).toBe(11.296);
  });

  it('inverts a pair quoted from the base currency when that is all there is', () => {
    const rates = buildRates([pair('SEK', 'USD', 0, [['2024-01-02', 0.1]])], 'SEK');
    expect(rates.USD[0].rate).toBeCloseTo(10);
  });

  it('sorts the history, drops empty closes, and ends on the current rate', () => {
    const rates = buildRates(
      [pair('EUR', 'SEK', 11.5, [['2024-01-03', 11.2], ['2024-01-02', 0], ['2024-01-01', 11.1]])],
      'SEK',
    );
    expect(rates.EUR).toEqual([
      { date: '2024-01-01', rate: 11.1 },
      { date: '2024-01-03', rate: 11.2 },
      { date: today(), rate: 11.5 },
    ]);
  });

  it('ignores pairs that do not touch the base currency', () => {
    expect(buildRates([pair('USD', 'EUR', 0.9, [['2024-01-02', 0.9]])], 'SEK')).toEqual({});
  });
});
