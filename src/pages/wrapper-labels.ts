import type { Wrapper } from '../lib/swedish-tax';

/** How each wrapper is named in the UI. The keys drive the dropdown's order. */
export const WRAPPER_LABELS: Record<Wrapper, string> = {
  ISK: 'ISK',
  DEPA: 'Depå',
  CRYPTO: 'Crypto',
  IGNORE: 'Not taxed here',
};
