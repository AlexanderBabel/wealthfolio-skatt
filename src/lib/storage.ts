import type { AddonContext } from '@wealthfolio/addon-sdk';
import type { Wrapper } from './swedish-tax';
import type { FilerInfo } from './sru';

/**
 * The two things this addon stores itself. Everything else it shows is read
 * back out of Wealthfolio, so this is the whole of its own persistent state.
 */

export const WRAPPERS_KEY = 'account-wrappers';
export const FILER_INFO_KEY = 'sru-filer-info';

export type WrapperMap = Record<string, Wrapper>;

/** Reads JSON out of addon storage, treating unparseable content as absent. */
async function read<T>(ctx: AddonContext, key: string, label: string): Promise<T | null> {
  const raw = await ctx.api.storage.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    ctx.api.logger.error(`Stored ${label} is not valid JSON, ignoring it.`);
    return null;
  }
}

export async function loadWrappers(ctx: AddonContext): Promise<WrapperMap> {
  return (await read<WrapperMap>(ctx, WRAPPERS_KEY, 'account classification')) ?? {};
}

export async function saveWrappers(ctx: AddonContext, wrappers: WrapperMap): Promise<void> {
  await ctx.api.storage.set(WRAPPERS_KEY, JSON.stringify(wrappers));
}

/** Personnummer and the rest of INFO.SRU's identity block, kept for next time. */
export async function loadFilerInfo(ctx: AddonContext): Promise<FilerInfo | null> {
  return read<FilerInfo>(ctx, FILER_INFO_KEY, 'SRU filer info');
}

export async function saveFilerInfo(ctx: AddonContext, filer: FilerInfo): Promise<void> {
  await ctx.api.storage.set(FILER_INFO_KEY, JSON.stringify(filer));
}
