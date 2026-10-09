import { Page } from '@playwright/test';
import { ALICE_USER, OLIVER_OAUTH_USER, OP_ADMIN_USER, type TestUser } from '../../utils/test-users';
import { logInfo, logWarn } from '../../utils/logger';
import { testConfig } from '../../utils/config';
import { resolveHosts } from '../../utils/env-hosts';
import { hostUrlPattern } from '../../utils/url-helpers';
import {
  deleteUploadedTestFile,
  ensureProjectHasNextcloudStorage,
  ensureUserIsAdmin,
  ensureUserIsProjectMember,
  waitForNextcloudStorageHealthy,
} from '../../utils/test-helpers';
import {
  deleteWorkPackageFileLinksByName,
  ensureOpenProjectLocalUser,
  findOpenProjectUser,
  listWorkPackageFileLinks,
  setUserAdmin,
} from '../../utils/openproject-api';
import type { EnsureAdminResult } from '../../utils/openproject-api';
import {
  ensureNextcloudLocalUser,
  ensureOauth2AmpfWebDavAccess,
} from '../../utils/nextcloud-api';
import {
  OpenProjectHomePage,
  OpenProjectLoginPage,
  OpenProjectWorkPackageFilesTab,
} from '../../pageobjects/openproject';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
} from '../../pageobjects/nextcloud';

export const ALICE_IDENTIFIERS = [
  ALICE_USER.username,
  ALICE_USER.email,
  `${ALICE_USER.username}@example.com`,
].filter((identifier, index, all): identifier is string => {
  return Boolean(identifier) && all.indexOf(identifier) === index;
});

export const uploadedFileName = `op-to-nc-upload-${Date.now()}.md`;
export const keepBothSiblingPattern = (() => {
  const dot = uploadedFileName.lastIndexOf('.');
  const stem = dot > 0 ? uploadedFileName.slice(0, dot) : uploadedFileName;
  const ext = dot > 0 ? uploadedFileName.slice(dot) : '';
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escape(stem)} \\(\\d+\\)${escape(ext)}`);
})();
export const ampProjectFolder = 'Demo project (1)';
export const replacedFileBody = Buffer.from(
  `## collision-replace-marker\nReplaced body ${Date.now()}\n`,
  'utf8'
);

export let aliceWasAdminBeforeSuite = false;
export let aliceAdminElevatedBySuite = false;

export async function captureAliceAdminStatus(): Promise<void> {
  for (const identifier of ALICE_IDENTIFIERS) {
    const user = await findOpenProjectUser(identifier);
    if (user) {
      aliceWasAdminBeforeSuite = user.admin;
      return;
    }
  }
}

export async function cleanupCollisionArtifacts(): Promise<void> {
  const names = new Set<string>([uploadedFileName]);
  try {
    const links = await listWorkPackageFileLinks(2);
    for (const link of links) {
      const name = link.originData?.name ?? link._links.self.title;
      if (name && keepBothSiblingPattern.test(name)) {
        names.add(name);
      }
    }
  } catch (err: unknown) {
    logWarn('[Cleanup] Failed to list work package file links:', err);
  }

  for (const name of names) {
    try {
      const deletedLinks = await deleteWorkPackageFileLinksByName(2, name);
      logInfo(`[Cleanup] Deleted file links for ${name}:`, deletedLinks);
    } catch (err: unknown) {
      logWarn(`[Cleanup] Failed to delete file links for ${name}:`, err);
    }

    try {
      await deleteUploadedTestFile(name, ampProjectFolder, ALICE_USER);
      logInfo(`[Cleanup] Deleted ${name} from ${ampProjectFolder}`);
    } catch (err: unknown) {
      logWarn(`[Cleanup] Failed to delete ${name} from Nextcloud:`, err);
    }
  }
}

export async function withAliceIdentifier<T>(
  action: (identifier: string) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (const identifier of ALICE_IDENTIFIERS) {
    try {
      return await action(identifier);
    } catch (error: unknown) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('not found via API')) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('OpenProject user for Alice not found via API');
}

export async function ensureAliceAdmin(): Promise<EnsureAdminResult> {
  return withAliceIdentifier((identifier) => ensureUserIsAdmin(identifier));
}

export async function ensureAliceIsDemoProjectMember(): Promise<void> {
  await withAliceIdentifier((identifier) =>
    ensureUserIsProjectMember(identifier, 'demo-project')
  );
}

export async function ensureAliceAdminForCurrentSession(
  page: Page,
  homePage: OpenProjectHomePage
): Promise<void> {
  const { updated } = await ensureAliceAdmin();
  if (updated) {
    aliceAdminElevatedBySuite = true;
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await homePage.waitForReady({ dismissOnboarding: false });
}

export async function restoreAliceAdminStatus(): Promise<void> {
  if (aliceAdminElevatedBySuite && !aliceWasAdminBeforeSuite) {
    try {
      await withAliceIdentifier(async (identifier) => {
        const user = await findOpenProjectUser(identifier);
        if (!user) {
          throw new Error('OpenProject user for Alice not found via API');
        }
        await setUserAdmin(user.id, false);
      });
      logInfo('[Cleanup] Revoked admin permissions from Alice');
    } catch (err: unknown) {
      logWarn('[Cleanup] Failed to revoke admin permissions from Alice:', err);
    }
  }
}

/** True when the stack is SETUP_METHOD=oauth2. */
export function isOauth2Setup(): boolean {
  return testConfig.setupMethod === 'oauth2';
}

/**
 * Browser user for dual-setup specs: Alice (Keycloak SSO) or Oliver (local oauth2).
 * Switch inside the same Squash case — do not duplicate TCs per setup method.
 */
export function integrationBrowserUser(): TestUser {
  return isOauth2Setup() ? OLIVER_OAUTH_USER : ALICE_USER;
}

/**
 * Ensure Oliver has a Nextcloud↔OpenProject OAuth connection via NC personal settings.
 * Idempotent: skips Connect when Disconnect is already visible.
 */
export async function ensureOliverConnectedViaNextcloudPersonalSettings(
  page: Page,
): Promise<void> {
  const ncLogin = new NextcloudLoginPage(page);
  const personalSettings = new NextcloudPersonalSettingsPage(page);
  const opLogin = new OpenProjectLoginPage(page);

  const dashboard = await ncLogin.login(OLIVER_OAUTH_USER.username, OLIVER_OAUTH_USER.password);
  await dashboard.waitForReady();
  await dashboard.closeWelcomeMessage();

  await personalSettings.navigateTo();
  await personalSettings.waitForReady();

  if (await personalSettings.isConnected(500)) {
    logInfo('Oliver already connected to OpenProject in Nextcloud personal settings');
    return;
  }

  logInfo('Connecting Oliver to OpenProject via Nextcloud personal settings OAuth');
  await personalSettings.clickConnectToOpenProject(0);
  const hosts = resolveHosts();
  await page.waitForURL(hostUrlPattern(hosts.openproject), { timeout: 20000 });

  const loggedIn = await opLogin.loginIfPrompted(
    OLIVER_OAUTH_USER.username,
    OLIVER_OAUTH_USER.password,
    15000,
  );
  logInfo(`OpenProject login prompted during OAuth: ${loggedIn}`);
  if (page.url().includes('/login')) {
    throw new Error(`Still on OpenProject login after Connect OAuth redirect: ${page.url()}`);
  }

  const authorized = await opLogin.authorizeOAuthApplicationIfPrompted(20000);
  logInfo(`OpenProject OAuth authorize clicked: ${authorized}`);

  await page.waitForURL(hostUrlPattern(hosts.nextcloud, 'settings\\/user\\/openproject'), {
    timeout: 45000,
  });
  await personalSettings.waitForReady();
  await personalSettings.waitForConnected(30000);
  logInfo('Oliver connected to OpenProject');
}

/**
 * Log in to OpenProject as the dual-setup integration user for the current SETUP_METHOD.
 */
export async function loginOpenProjectAsIntegrationUser(
  page: Page,
): Promise<OpenProjectHomePage> {
  const loginPage = new OpenProjectLoginPage(page);
  const homePage = new OpenProjectHomePage(page);

  if (isOauth2Setup()) {
    await ensureOpenProjectLocalUser(OLIVER_OAUTH_USER);
    await ensureNextcloudLocalUser(OLIVER_OAUTH_USER);
    await loginPage.login(OLIVER_OAUTH_USER.username, OLIVER_OAUTH_USER.password);
    await homePage.waitForReady();
    return homePage;
  }

  await loginPage.navigateTo();
  const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
  await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
  await homePage.waitForReady();
  return homePage;
}

/** Demo project WP used for Files-tab storage OAuth / health probes. */
const DEMO_WORK_PACKAGE_ID = 2;

/**
 * Membership + Demo project Nextcloud storage for the dual-setup user.
 * oauth2: admin links storage, Oliver NC↔OP + Files storage OAuth, then AMPF WebDAV ACL.
 * sso-external: Alice member/admin elevation + storage link (existing path).
 */
export async function prepareIntegrationUserForDemoStorage(
  page: Page,
  homePage: OpenProjectHomePage,
): Promise<{ homePage: OpenProjectHomePage; user: TestUser }> {
  const user = integrationBrowserUser();

  if (isOauth2Setup()) {
    await ensureUserIsProjectMember(OLIVER_OAUTH_USER.username, 'demo-project', 'Member');

    await page.context().clearCookies();
    const opLogin = new OpenProjectLoginPage(page);
    const adminHome = await opLogin.login(OP_ADMIN_USER.username, OP_ADMIN_USER.password);
    await adminHome.waitForReady();
    await ensureProjectHasNextcloudStorage('demo-project', page);

    // Personal settings (NC→OP) then Files-tab storage OAuth (OP→NC).
    await page.context().clearCookies();
    await ensureOliverConnectedViaNextcloudPersonalSettings(page);

    await page.context().clearCookies();
    let oliverHome = await opLogin.login(
      OLIVER_OAUTH_USER.username,
      OLIVER_OAUTH_USER.password,
    );
    await oliverHome.waitForReady();
    const filesTab = new OpenProjectWorkPackageFilesTab(page);
    await ensureFilesTabNextcloudConnected(
      page,
      filesTab,
      DEMO_WORK_PACKAGE_ID,
      OLIVER_OAUTH_USER,
    );

    await waitForNextcloudStorageHealthy('demo-project');
    await ensureOauth2AmpfWebDavAccess(OLIVER_OAUTH_USER, {
      projectFolder: ampProjectFolder,
    });
    return { homePage: oliverHome, user };
  }

  await ensureAliceIsDemoProjectMember();
  await ensureAliceAdminForCurrentSession(page, homePage);
  await homePage.waitForReady();
  await ensureProjectHasNextcloudStorage('demo-project', page);
  await waitForNextcloudStorageHealthy('demo-project');
  return { homePage, user };
}

/**
 * Ensure the WP Files tab Nextcloud section is connected for the current user.
 * On oauth2 (and first SSO connect), completes the OP→NC storage OAuth login prompt:
 * Nextcloud login → Grant access → OpenProject Authorize.
 * Do not treat the generic Attachments dropzone as Nextcloud-connected.
 */
export async function ensureFilesTabNextcloudConnected(
  page: Page,
  filesTab: OpenProjectWorkPackageFilesTab,
  workPackageId: number,
  user: TestUser = integrationBrowserUser(),
): Promise<void> {
  await filesTab.navigateToDemoProjectWorkPackageFiles(workPackageId);
  await filesTab.waitForDemoProjectWorkPackageFilesUrl();

  const loginBtn = filesTab.getNextcloudLoginButtonLocator();
  const linkExisting = filesTab.getLocator('linkExistingFilesButton').first();

  // Files Nextcloud section loads async after the URL is ready — poll either outcome.
  let state: 'login' | 'connected' | null = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await linkExisting.isVisible().catch(() => false)) {
      state = 'connected';
      break;
    }
    if (await loginBtn.isVisible().catch(() => false)) {
      state = 'login';
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!state) {
    throw new Error(
      'Files tab Nextcloud section neither showed login nor link-existing controls within 45s',
    );
  }

  if (state === 'login') {
    logInfo('Files tab shows Nextcloud login; completing storage OAuth as %s', user.username);
    const hosts = resolveHosts();
    const ncHostPattern = hostUrlPattern(hosts.nextcloud);
    const opHostPattern = hostUrlPattern(hosts.openproject);
    const popupPromise = page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null);
    await filesTab.clickNextcloudLogin();
    const popup = await popupPromise;
    const oauthPage = popup ?? page;

    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
    } else {
      await page.waitForURL(ncHostPattern, { timeout: 20000 });
    }

    const ncLogin = new NextcloudLoginPage(oauthPage);
    // NC storage OAuth: interstitial "Log in" → credentials → Grant access.
    const interstitial = await ncLogin.clickOAuthConnectLoginIfPrompted(10000);
    logInfo('Nextcloud OAuth interstitial Log in clicked: %s', interstitial);
    const loggedIn = await ncLogin.loginIfPrompted(user.username, user.password, 15000);
    logInfo('Nextcloud login form submitted: %s', loggedIn);
    const granted = await ncLogin.grantAccessIfPrompted(20000);
    logInfo('Nextcloud Grant access clicked: %s', granted);

    const opLogin = new OpenProjectLoginPage(oauthPage);
    // After NC grant, OP asks to Authorize Nextcloud API access (same tab or popup).
    if (popup) {
      await Promise.race([
        popup.waitForURL(opHostPattern, { timeout: 45000 }),
        popup.waitForEvent('close', { timeout: 45000 }).then(() => null),
      ]).catch(() => null);
      if (!popup.isClosed()) {
        const authorized = await opLogin.authorizeOAuthApplicationIfPrompted(20000);
        logInfo('OpenProject storage OAuth authorize clicked: %s', authorized);
        await popup.waitForEvent('close', { timeout: 30000 }).catch(() => undefined);
      }
    } else {
      await page.waitForURL(opHostPattern, { timeout: 45000 });
      const authorized = await opLogin.authorizeOAuthApplicationIfPrompted(20000);
      logInfo('OpenProject storage OAuth authorize clicked: %s', authorized);
    }

    await filesTab.navigateToDemoProjectWorkPackageFiles(workPackageId);
    await filesTab.waitForDemoProjectWorkPackageFilesUrl(30000);
  }

  // Prefer the link-existing control (Nextcloud-specific) over generic attachment dropzone.
  await linkExisting.waitFor({ state: 'visible', timeout: 30000 });
  await filesTab.waitForNextcloudFilesSectionConnected(workPackageId);
}
