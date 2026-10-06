import { Agent, fetch as undiciFetch } from 'undici';
import type { RequestInfo, RequestInit } from 'undici';
import { resolveEnvName } from './env-hosts';

/**
 * Returns an undici Agent that skips TLS verification for local/dev environments.
 * Used by version-detect, nextcloud-api, and openproject-api.
 */
export function getDispatcher(): Agent | undefined {
  const envName = resolveEnvName();
  const allowInsecureTls = envName === 'local' || process.env.ALLOW_INSECURE_TLS === '1';
  return allowInsecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
}

/**
 * Fetch that uses the same undici major as {@link getDispatcher}.
 * Node's global fetch cannot accept an Agent from a separately installed undici 8+.
 */
export function tlsFetch(
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  const dispatcher = getDispatcher();
  return undiciFetch(input, {
    ...init,
    ...(dispatcher ? { dispatcher } : {}),
  }) as unknown as Promise<Response>;
}
