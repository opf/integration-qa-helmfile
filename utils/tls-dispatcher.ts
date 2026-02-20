import { Agent } from 'undici';
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
