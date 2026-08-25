import type { ActivityDetails } from '@wealthfolio/addon-sdk';

/**
 * Wealthfolio stores amounts and quantities as strings. Reading them anywhere
 * else in this addon goes through these, so a missing or unparseable value is
 * 0 everywhere rather than NaN in one place and undefined in another.
 */
export const amountOf = (a: ActivityDetails) => Number(a.amount ?? 0) || 0;
export const quantityOf = (a: ActivityDetails) => Number(a.quantity ?? 0) || 0;
export const feeOf = (a: ActivityDetails) => Number(a.fee ?? 0) || 0;
