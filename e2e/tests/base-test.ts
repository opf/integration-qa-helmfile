import { test as base, expect } from '@playwright/test';
import { Page } from '@playwright/test';
import { testConfig, type SetupMethod } from '../utils/config';
import { escapeForRegex, resolveHostname } from '../utils/url-helpers';
import { logDebug } from '../utils/logger';

export const test = base.extend({});

/** Shared tags for opncintegration specs (no setup-method exclusivity). */
export const integrationTags = { tag: ['@regression', '@integration', '@smoke'] };

/** OAuth2-only specs — skip unless SETUP_METHOD=oauth2. */
export const oauth2Tags = {
  tag: ['@regression', '@integration', '@smoke', '@oauth2'],
};

/** SSO-external (Keycloak) specs — skip unless SETUP_METHOD=sso-external. */
export const ssoExternalTags = {
  tag: ['@regression', '@integration', '@smoke', '@sso-external'],
};

/**
 * Specs that run on both sso-external and oauth2 (auth path switches inside the test).
 * Tagged with both mode tags so `--grep @oauth2` / `--grep @sso-external` still discover them.
 */
export const dualSetupTags = {
  tag: ['@regression', '@integration', '@smoke', '@sso-external', '@oauth2'],
};

/** True when `testConfig.setupMethod` is one of the allowed values. */
export function isSetupMethod(...allowed: SetupMethod[]): boolean {
  return allowed.includes(testConfig.setupMethod);
}

/** Skip the current test unless SETUP_METHOD is one of the allowed values. */
export function skipUnlessSetupMethod(...allowed: SetupMethod[]): void {
  test.skip(
    !isSetupMethod(...allowed),
    `Requires SETUP_METHOD in [${allowed.join(', ')}] (current: ${testConfig.setupMethod})`,
  );
}

test.beforeEach(async ({ page }, testInfo) => {
  const versions = [
    { type: 'openproject_version', description: `OpenProject: ${testConfig.openproject.version}` },
    { type: 'nextcloud_version', description: `Nextcloud: ${testConfig.nextcloud.version}` },
    { type: 'nc_api_version', description: `NC API: ${testConfig.nextcloud.apiVersion}` },
    { type: 'integration_app', description: `Integration App: ${testConfig.nextcloud.integrationAppVersion}` },
    { type: 'team_folders', description: `Team Folders: ${testConfig.nextcloud.teamFoldersVersion}` },
    { type: 'keycloak_version', description: `Keycloak: ${testConfig.keycloak.version}` },
  ];
  for (const ann of versions) {
    testInfo.annotations.push(ann);
  }

  attachDebugListeners(page);
});

export function attachDebugListeners(page: Page): void {
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      logDebug('[PAGE NAVIGATION] Frame navigated to:', frame.url());
    }
  });
  page.on('request', (request) => {
    logDebug('[NETWORK REQUEST]', request.method(), request.url());
  });
  page.on('response', (response) => {
    logDebug('[NETWORK RESPONSE]', response.status(), response.url());
  });
  page.on('console', (msg) => {
    logDebug('[PAGE CONSOLE]', msg.type() + ':', msg.text());
  });
}

/**
 * Build a URL regex for a given host and path.
 * Host can be a hostname (e.g. "openproject.test") or a full URL.
 */
export function urlForHost(path: string, host: string): RegExp {
  const escapedHost = escapeForRegex(resolveHostname(host) || host);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const pathPattern = cleanPath.endsWith('/')
    ? cleanPath.slice(0, -1) + '/?'
    : cleanPath + '/?';
  return new RegExp(`^https?://${escapedHost}${pathPattern}$`);
}

export const openProjectUrl = (path: string) =>
  urlForHost(
    path,
    process.env.OPENPROJECT_URL ||
      process.env.OPENPROJECT_HOST ||
      testConfig.openproject.host,
  );

export { expect };
