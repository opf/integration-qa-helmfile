/**
 * Warm e2e/.auth/*.json once per run for op-integration-tests.
 * Dependent projects restore via shared login helpers; missing/stale files re-login.
 */
import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import {
  clearAuthDir,
  personaFileExists,
  personaPath,
  restorePersona,
  savePersona,
} from '../utils/auth-session';
import { NC_ADMIN_USER } from '../utils/test-users';
import { getErrorMessage } from '../utils/error-utils';
import { logInfo, logWarn } from '../utils/logger';
import { NextcloudLoginPage } from '../pageobjects/nextcloud';
import {
  captureAliceAdminStatus,
  ensureSecondaryIntegrationUserProvisioned,
  integrationBrowserUser,
  isOauth2Setup,
  loginNextcloudAsAdmin,
  loginOpenProjectAsIntegrationUser,
  loginOpenProjectAsSecondaryUser,
  loginOpenProjectAsStorageAdmin,
  secondaryIntegrationUser,
} from './opncintegration/shared';

setup.describe.configure({ mode: 'serial' });
setup.setTimeout(300_000);

setup.beforeAll(() => {
  clearAuthDir();
});

setup('storage-admin persona', async ({ page }) => {
  if (!isOauth2Setup()) {
    try {
      await captureAliceAdminStatus();
    } catch (error: unknown) {
      logWarn('[auth.setup] captureAliceAdminStatus: %s', getErrorMessage(error));
    }
  }
  await loginOpenProjectAsStorageAdmin(page, { cold: true });
  await savePersona(page.context(), 'storage-admin');
  expect(personaFileExists('storage-admin')).toBe(true);
});

setup('integration persona (OP + NC)', async ({ page }) => {
  // SSO: Alice already warmed as storage-admin — reuse OP/KC cookies, then add NC.
  // Avoid a second cold OP login here (Keycloak/OP load hangs under serial setup pressure).
  if (!isOauth2Setup() && personaFileExists('storage-admin')) {
    const restored = await restorePersona(page.context(), 'storage-admin');
    if (!restored) {
      await loginOpenProjectAsIntegrationUser(page, { cold: true });
    }
  } else {
    await loginOpenProjectAsIntegrationUser(page, { cold: true });
  }
  // Do not clearCookies here — keep OP + KC cookies in the same storageState.
  const user = integrationBrowserUser();
  const ncLogin = new NextcloudLoginPage(page);
  await ncLogin.login(user.username, user.password, {
    redirectPath: '/index.php/apps/files/files',
  });
  await savePersona(page.context(), 'integration');
  expect(personaFileExists('integration')).toBe(true);
});

setup('secondary persona (OP + NC)', async ({ page }) => {
  await ensureSecondaryIntegrationUserProvisioned(page);
  if (!personaFileExists('secondary')) {
    // oauth2 provision is API-only — warm OP+NC in one context (do not cold-clear between).
    await loginOpenProjectAsSecondaryUser(page, { cold: true });
    const user = secondaryIntegrationUser();
    const ncLogin = new NextcloudLoginPage(page);
    await ncLogin.login(user.username, user.password, {
      redirectPath: '/index.php/apps/files/files',
    });
    await savePersona(page.context(), 'secondary');
  }
  expect(personaFileExists('secondary')).toBe(true);
});

setup('nc-admin persona', async ({ page }) => {
  await loginNextcloudAsAdmin(page, {
    cold: true,
    redirectPath: '/index.php/apps/files/files',
  });
  await savePersona(page.context(), 'nc-admin');
  expect(personaFileExists('nc-admin')).toBe(true);
  logInfo('[auth.setup] nc-admin warmed as %s', NC_ADMIN_USER.username);
});

/**
 * Assert recovery: empty integration cookies → ensure re-logins and rewrites.
 * Exercises the invalid-session path every run without a separate chaos suite.
 */
setup('integration persona recovery self-check', async ({ page }) => {
  const file = personaPath('integration');
  fs.writeFileSync(file, JSON.stringify({ cookies: [] }), 'utf8');

  await loginOpenProjectAsIntegrationUser(page);
  expect(personaFileExists('integration')).toBe(true);
  const rewritten = JSON.parse(fs.readFileSync(file, 'utf8')) as { cookies?: unknown[] };
  expect(Array.isArray(rewritten.cookies) && rewritten.cookies.length > 0).toBe(true);
});
