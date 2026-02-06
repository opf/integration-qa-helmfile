/**
 * Shared environment and host resolution used by config.ts,
 * version-detect.ts, and openproject-api.ts.
 */

export interface ResolvedHosts {
  openproject: string;
  nextcloud: string;
  keycloak: string;
}

const HOST_DEFAULTS: Record<string, ResolvedHosts> = {
  edge:  { openproject: 'openproject.edge',  nextcloud: 'nextcloud.edge',  keycloak: 'keycloak.edge'  },
  stage: { openproject: 'openproject.stage', nextcloud: 'nextcloud.stage', keycloak: 'keycloak.stage' },
  local: { openproject: 'openproject.test',  nextcloud: 'nextcloud.test',  keycloak: 'keycloak.test'  },
};

/** Resolve the current environment name (edge | stage | local). */
export function resolveEnvName(): string {
  return (process.env.E2E_ENV || process.env.ENV || 'local').toLowerCase();
}

export function resolveHosts(envName?: string): ResolvedHosts {
  const env = envName ?? resolveEnvName();
  const defaults = HOST_DEFAULTS[env] ?? HOST_DEFAULTS.local;

  return {
    openproject: process.env.OPENPROJECT_HOST || process.env.OPENPROJECT_URL || defaults.openproject,
    nextcloud:   process.env.NEXTCLOUD_HOST   || process.env.NEXTCLOUD_URL   || defaults.nextcloud,
    keycloak:    process.env.KEYCLOAK_HOST    || process.env.KEYCLOAK_URL    || defaults.keycloak,
  };
}