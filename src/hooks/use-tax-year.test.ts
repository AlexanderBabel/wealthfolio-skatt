import { describe, expect, it } from 'vitest';
import { day } from './use-tax-year';

describe('day', () => {
  it('formats a Date the way the host API parses dates', () => {
    // `String(date).slice(0, 10)` yields "Sun Aug 09", which the host rejects
    // as an invalid date - the reason this helper exists.
    expect(day(new Date(Date.UTC(2026, 7, 9, 22, 30)))).toBe('2026-08-09');
  });

  it('leaves an ISO string alone', () => {
    expect(day('2026-07-02T00:00:00+00:00')).toBe('2026-07-02');
    expect(day('2026-07-02')).toBe('2026-07-02');
  });
});
