import { test as base, expect } from '@playwright/test';
import type { Frame, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { testConfig, type SetupMethod } from '../utils/config';
import { escapeForRegex, resolveHostname } from '../utils/url-helpers';
import { logDebug } from '../utils/logger';

/** Optional dwell-time capture: set E2E_PAGE_TIMING=1 to write page-timing.jsonl. */
type PageDwellSegment = { url: string; host: string; path: string; startedAt: number; ms: number };

function classifyPageUrl(rawUrl: string): { url: string; host: string; path: string } {
  try {
    if (!rawUrl || rawUrl === 'about:blank') {
      return { url: 'about:blank', host: '', path: '/blank' };
    }
    const u = new URL(rawUrl);
    const pathOnly = (u.pathname || '/').replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const origin = u.origin === 'null' ? `${u.protocol}//${u.hostname}` : u.origin;
    return { url: `${origin}${pathOnly}`, host: u.hostname, path: pathOnly };
  } catch {
    return { url: rawUrl, host: '', path: rawUrl };
  }
}

function pageTimingLogPath(): string {
  return path.resolve(__dirname, '..', 'playwright-report', 'page-timing.jsonl');
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const timingOn = process.env.E2E_PAGE_TIMING === '1';
    const segments: PageDwellSegment[] = [];
    let current = { ...classifyPageUrl(page.url()), startedAt: Date.now() };

    const flush = (nextUrl: string) => {
      const now = Date.now();
      const ms = now - current.startedAt;
      if (current.url && current.url !== 'about:blank' && ms >= 0) {
        segments.push({ ...current, ms });
      }
      current = { ...classifyPageUrl(nextUrl), startedAt: now };
    };

    const onNav = (frame: Frame) => {
      if (frame !== page.mainFrame()) return;
      const next = frame.url();
      if (classifyPageUrl(next).url !== current.url) {
        flush(next);
      }
    };

    if (timingOn) {
      page.on('framenavigated', onNav);
    }

    await use(page);

    if (!timingOn) return;

    page.off('framenavigated', onNav);
    try {
      flush(page.isClosed() ? current.url : page.url());
    } catch {
      flush(current.url);
    }

    // Always record (even empty segments) so we know the hook ran.
    const out = pageTimingLogPath();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.appendFileSync(
      out,
      `${JSON.stringify({
        title: testInfo.title,
        file: testInfo.file,
        project: testInfo.project.name,
        status: testInfo.status,
        durationMs: testInfo.duration,
        segments,
      })}\n`,
    );
  },
});

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
