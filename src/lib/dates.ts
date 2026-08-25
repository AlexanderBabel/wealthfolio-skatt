/**
 * Date handling for a Swedish tax year, which is a local calendar year.
 *
 * Kept apart from anything that reads the host API: every other module wants
 * `day()` and none of them should reimplement it.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * YYYY-MM-DD in the local calendar, which is the one a Swedish tax year is
 * counted in. Timestamps come back as the instant of local midnight, so a
 * trade on 18 July is stored as `2022-07-17T22:00:00Z` in summer - reading
 * that in UTC would file it a day early, and on 1 January, a year early.
 */
export const day = (d: Date | string): string => {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const today = (): string => day(new Date());

/** The calendar year of a date, as a string, for comparing against a tax year. */
export const yearOf = (date: string): string => date.slice(0, 4);
