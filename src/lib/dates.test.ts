import { describe, expect, it } from 'vitest';
import { day, lastOnOrBefore } from './dates';

describe('day', () => {
  it('formats a Date the way the host API parses dates', () => {
    // `String(date).slice(0, 10)` yields "Sun Aug 09", which the host rejects
    // as an invalid date - the reason this helper exists.
    expect(day(new Date(2026, 7, 9, 12, 0))).toBe('2026-08-09');
  });

  it('leaves a plain date string alone', () => {
    expect(day('2026-07-02')).toBe('2026-07-02');
  });

  it('reads a stored timestamp in the local calendar, not UTC', () => {
    // Local midnight is stored as the UTC instant before it east of Greenwich.
    // Read in UTC, a 1 January trade would land in the previous tax year.
    const localMidnight = new Date(2026, 0, 1, 0, 0, 0);
    expect(day(localMidnight.toISOString())).toBe('2026-01-01');
  });
});

describe('lastOnOrBefore', () => {
  const points = ['2024-01-02', '2024-01-05', '2024-01-05', '2024-02-01'].map((date, i) => ({ date, i }));
  const at = (date: string) => lastOnOrBefore(points, date, (p) => p.date)?.i;

  it('finds the closest earlier entry, taking the last of equal dates', () => {
    expect(at('2024-01-01')).toBeUndefined();
    expect(at('2024-01-02')).toBe(0);
    expect(at('2024-01-04')).toBe(0);
    expect(at('2024-01-05')).toBe(2);
    expect(at('2030-01-01')).toBe(3);
    expect(lastOnOrBefore([], '2024-01-01', String)).toBeUndefined();
  });
});
