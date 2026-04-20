import { test as base, expect } from '@playwright/test';
import { Page } from '@playwright/test';
import { testConfig } from '../utils/config';
import { escapeForRegex, resolveHostname } from '../utils/url-helpers';
import { logDebug } from '../utils/logger';

export const test = base.extend({});

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

export const integrationTags = { tag: ['@regression', '@integration'] };

export { expect };
