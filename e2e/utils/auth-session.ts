/**
 * Playwright storageState cache for E2E personas.
 * Setup warms e2e/.auth/*.json; helpers restore cookies or UI-login on miss.
 * Prefer project `use.storageState` / `browser.newContext({ storageState })` when
 * a whole file stays on one persona — avoids per-test restore. Not multi-worker safe.
 */
import type { BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { getErrorMessage } from './error-utils';
import { logInfo, logWarn } from './logger';

export type AuthPersona = 'storage-admin' | 'integration' | 'secondary' | 'nc-admin';

export type SessionOptions = {
  /** Skip restore/save — full UI login for specs that assert login UX. */
  cold?: boolean;
};

type StorageStateFile = {
  cookies?: Array<Parameters<BrowserContext['addCookies']>[0][number]>;
};

const AUTH_DIR = path.resolve(__dirname, '..', '.auth');

export function personaPath(persona: AuthPersona): string {
  return path.join(AUTH_DIR, `${persona}.json`);
}

/** Wipe and recreate .auth (call at start of auth.setup). */
export function clearAuthDir(): void {
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  logInfo('[auth-session] cleared %s', AUTH_DIR);
}

export function invalidatePersona(persona: AuthPersona): void {
  const file = personaPath(persona);
  if (!fs.existsSync(file)) {
    return;
  }
  fs.unlinkSync(file);
  logWarn('[auth-session] invalidated persona %s', persona);
}

export function personaFileExists(persona: AuthPersona): boolean {
  return fs.existsSync(personaPath(persona));
}

export async function savePersona(
  context: BrowserContext,
  persona: AuthPersona,
): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await context.storageState({ path: personaPath(persona) });
  logInfo('[auth-session] saved persona %s', persona);
}

/**
 * Replace context cookies with a saved persona. Returns false when missing/corrupt.
 * Session cookies are enough for OP/NC/KC auth.
 */
export async function restorePersona(
  context: BrowserContext,
  persona: AuthPersona,
): Promise<boolean> {
  const file = personaPath(persona);
  if (!fs.existsSync(file)) {
    return false;
  }

  let state: StorageStateFile;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8')) as StorageStateFile;
  } catch (error: unknown) {
    logWarn(
      '[auth-session] corrupt persona %s: %s',
      persona,
      getErrorMessage(error),
    );
    invalidatePersona(persona);
    return false;
  }

  if (!Array.isArray(state.cookies) || state.cookies.length === 0) {
    logWarn('[auth-session] empty cookies for persona %s', persona);
    invalidatePersona(persona);
    return false;
  }

  await context.clearCookies();
  await context.addCookies(state.cookies);
  return true;
}

/**
 * Restore persona cookies when possible; otherwise run login and save (unless cold).
 * Trusts restored cookies (no probe navigation) — stale sessions fail on the first
 * real step; the next cold login path / helper call re-logins.
 */
export async function ensureWithRecovery(
  page: Page,
  persona: AuthPersona,
  opts: {
    cold?: boolean;
    login: () => Promise<void>;
  },
): Promise<'restored' | 'logged-in' | 'cold'> {
  if (opts.cold) {
    await page.context().clearCookies();
    await opts.login();
    return 'cold';
  }

  const restored = await restorePersona(page.context(), persona);
  if (restored) {
    logInfo('[auth-session] restored persona %s', persona);
    return 'restored';
  }

  await page.context().clearCookies();
  await opts.login();
  await savePersona(page.context(), persona);
  return 'logged-in';
}
