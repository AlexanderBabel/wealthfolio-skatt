import { describe, expect, it } from 'vitest';
import { day } from './dates';

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
