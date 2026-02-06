import { test as base, expect } from '@playwright/test';
import { Page } from '@playwright/test';
import { testConfig } from '../utils/config';

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
      console.log(`[PAGE NAVIGATION] Frame navigated to: ${frame.url()}`);
    }
  });
  page.on('request', (request) => {
    console.log(`[NETWORK REQUEST] ${request.method()} ${request.url()}`);
  });
  page.on('response', (response) => {
    console.log(`[NETWORK RESPONSE] ${response.status()} ${response.url()}`);
  });
  page.on('console', (msg) => {
    console.log(`[PAGE CONSOLE] ${msg.type()}: ${msg.text()}`);
  });
}

/**
 * Build a URL regex for a given host and path.
 * Host can be a hostname (e.g. "openproject.test") or a full URL.
 */
export function urlForHost(path: string, host: string): RegExp {
  const escapeForRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const resolveHostname = (value: string): string => {
    try {
      return new URL(value).hostname;
    } catch {
      return value;
    }
  };
  const escapedHost = escapeForRegex(resolveHostname(host));
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const pathPattern = cleanPath.endsWith('/')
    ? cleanPath.slice(0, -1) + '/?'
    : cleanPath + '/?';
  return new RegExp(`^https?://${escapedHost}${pathPattern}$`);
}

export const openProjectUrl = (path: string) =>
  urlForHost(path, testConfig.openproject.host);
export const nextcloudUrl = (path: string) =>
  urlForHost(path, testConfig.nextcloud.host);
export const keycloakUrl = (path: string) =>
  urlForHost(path, testConfig.keycloak.host);

export const integrationTags = { tag: ['@regression', '@integration'] };

export { expect };
