import { expect, Page } from '@playwright/test';
import {
  ALICE_USER,
  BOB_OAUTH_USER,
  BRIAN_USER,
  OLIVER_OAUTH_USER,
  OP_ADMIN_USER,
  type TestUser,
} from '../../utils/test-users';
import { logInfo, logWarn } from '../../utils/logger';
import { testConfig } from '../../utils/config';
import { resolveEnvName, resolveHosts } from '../../utils/env-hosts';
import { hostUrlPattern } from '../../utils/url-helpers';
import { squashTestCase } from '../../utils/squash-metadata';
import {
  deleteUploadedTestFile,
  ensureProjectHasNextcloudStorage,
  ensureUserIsAdmin,
  ensureUserIsProjectMember,
  isProjectNextcloudStorageLinked,
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
  isNextcloudUserConnectedToOpenProject,
} from '../../utils/nextcloud-api';
import {
  OpenProjectAdminStoragesPage,
  OpenProjectHomePage,
  OpenProjectLoginPage,
  OpenProjectWorkPackageFilesTab,
} from '../../pageobjects/openproject';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
} from '../../pageobjects/nextcloud';
import { runAutomaticallyManagedStorageSync } from '../../utils/openproject-oauth-tokens';

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
      await deleteUploadedTestFile(name, ampProjectFolder, integrationBrowserUser());
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
 * Secondary integration user (AMPF member sync / permission boundary):
 * Bob on oauth2, Brian on Keycloak SSO.
 */
export function secondaryIntegrationUser(): TestUser {
  return isOauth2Setup() ? BOB_OAUTH_USER : BRIAN_USER;
}

/**
 * Pick Squash title + ID for the current SETUP_METHOD so each mode reports to its own case.
 * SSO titles must stay unchanged (existing Squash automated references).
 */
export function dualSetupSquashCase(
  sso: { id: number; title: string },
  oauth2: { id: number; title: string },
  stepCount: number,
): { title: string; details: ReturnType<typeof squashTestCase> } {
  const { id, title } = isOauth2Setup() ? oauth2 : sso;
  return { title, details: squashTestCase(id, { stepCount }) };
}

/**
 * Admin session for project-storage specs: OP admin on oauth2, Alice+admin elevation on SSO.
 */
export async function loginOpenProjectAsStorageAdmin(
  page: Page,
): Promise<OpenProjectHomePage> {
  const loginPage = new OpenProjectLoginPage(page);

  if (isOauth2Setup()) {
    const homePage = await loginPage.login(OP_ADMIN_USER.username, OP_ADMIN_USER.password);
    await homePage.waitForReady();
    return homePage;
  }

  await loginPage.navigateTo();
  const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
  await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
  const homePage = new OpenProjectHomePage(page);
  await homePage.waitForReady();
  await ensureAliceAdminForCurrentSession(page, homePage);
  return homePage;
}

/**
 * Ensure Oliver has a Nextcloud↔OpenProject OAuth connection via NC personal settings.
 * Idempotent: skips Connect when Disconnect is already visible.
 * Uses login redirect to personal settings to avoid the dashboard settle.
 */
export async function ensureOliverConnectedViaNextcloudPersonalSettings(
  page: Page,
): Promise<void> {
  if (await isNextcloudUserConnectedToOpenProject(OLIVER_OAUTH_USER)) {
    logInfo('Oliver already connected to OpenProject (OCS probe)');
    return;
  }

  const ncLogin = new NextcloudLoginPage(page);
  const personalSettings = new NextcloudPersonalSettingsPage(page);
  const opLogin = new OpenProjectLoginPage(page);

  await ncLogin.login(OLIVER_OAUTH_USER.username, OLIVER_OAUTH_USER.password, {
    redirectPath: '/index.php/settings/user/openproject',
  });
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

/**
 * Ensure the secondary dual-setup user exists in OpenProject and Nextcloud
 * before membership API calls. SSO Brian is JIT-created via Keycloak on both
 * apps (AMPF ACL sync needs the NC identity). Leaves no browser session.
 */
export async function ensureSecondaryIntegrationUserProvisioned(
  page: Page,
): Promise<TestUser> {
  const user = secondaryIntegrationUser();
  if (isOauth2Setup()) {
    await ensureOpenProjectLocalUser(user);
    await ensureNextcloudLocalUser(user);
    return user;
  }

  const loginPage = new OpenProjectLoginPage(page);
  const homePage = new OpenProjectHomePage(page);
  logInfo('Provisioning SSO secondary user %s via Keycloak → OpenProject', user.username);
  await loginPage.navigateTo();
  const keycloak = await loginPage.clickKeycloakAuthButton();
  await keycloak.loginAsUser(user.username, user.password);
  await homePage.waitForReady();
  await page.context().clearCookies();

  // NC JIT so AMPF Sync now can grant groupfolder ACL before WebDAV probes.
  logInfo('Provisioning SSO secondary user %s via Keycloak → Nextcloud', user.username);
  const ncLogin = new NextcloudLoginPage(page);
  await ncLogin.login(user.username, user.password, {
    redirectPath: '/index.php/apps/files/files',
  });
  await page.context().clearCookies();
  return user;
}

/**
 * Trigger AMPF managed-folder sync. Prefers kubectl rails job; when unavailable
 * or cluster exec fails (PullPreview / Docker CI), falls back to
 * Admin → File storages → Sync now. Leaves no browser session after the UI path.
 */
export async function ensureAmpfStorageSynced(page: Page): Promise<void> {
  // Local kubectl against a different cluster (e.g. k3d while targeting PullPreview)
  // raises "No file storage found" — only try rails when hosts look local/cluster.
  const opHost = resolveHosts().openproject;
  const remotePreview = /\.opf\.run|pullpreview/i.test(opHost) || resolveEnvName() === 'pullpreview';
  if (!remotePreview) {
    try {
      if (await runAutomaticallyManagedStorageSync()) {
        return;
      }
    } catch (error: unknown) {
      logWarn(
        'AMPF rails sync failed (%s); falling back to Admin UI Sync now',
        error instanceof Error ? error.message : String(error),
      );
    }
  } else {
    logInfo('Remote/PullPreview host — skipping kubectl AMPF sync; using Admin UI Sync now');
  }

  logInfo('Triggering AMPF sync via Admin UI Sync now');
  const homePage = await loginOpenProjectAsStorageAdmin(page);
  await homePage.navigateToAdminStoragesSettings();
  await homePage.waitForAdminStoragesSettingsUrl();
  const adminStorages = new OpenProjectAdminStoragesPage(page);
  await adminStorages.openNextcloudStorage();
  await adminStorages.clickSyncNow();
  await adminStorages.waitForAmpfSyncSettled();
  await page.context().clearCookies();
}

/** Demo project WP used for Files-tab storage OAuth / health probes. */
export const DEMO_WORK_PACKAGE_ID = 2;

export type PrepareIntegrationUserOptions = {
  /**
   * When true (oauth2), leave an OpenProject browser session as Oliver.
   * Specs that only need NC should omit this — Files-tab OAuth is done by
   * `ensureFilesTabNextcloudConnected` in those that need it.
   */
  openProjectSession?: boolean;
};

/**
 * Membership + Demo project Nextcloud storage for the dual-setup user.
 * oauth2: API user/membership, link storage only if missing, NC↔OP connect (API probe
 * or personal-settings UI), AMPF WebDAV ACL. Optional OP Oliver session.
 * sso-external: Alice login + member/admin elevation + storage link.
 * Callers must not log in beforehand — oauth2 may start as admin; SSO logs in Alice here.
 */
export async function prepareIntegrationUserForDemoStorage(
  page: Page,
  options: PrepareIntegrationUserOptions = {},
): Promise<{ homePage: OpenProjectHomePage; user: TestUser }> {
  const user = integrationBrowserUser();
  const openProjectSession = options.openProjectSession === true;

  if (isOauth2Setup()) {
    await ensureOpenProjectLocalUser(OLIVER_OAUTH_USER);
    await ensureNextcloudLocalUser(OLIVER_OAUTH_USER);
    await ensureUserIsProjectMember(OLIVER_OAUTH_USER.username, 'demo-project', 'Member');

    const storageLinked = await isProjectNextcloudStorageLinked('demo-project');
    if (!storageLinked) {
      await page.context().clearCookies();
      const opLogin = new OpenProjectLoginPage(page);
      const adminHome = await opLogin.login(OP_ADMIN_USER.username, OP_ADMIN_USER.password);
      await adminHome.waitForReady();
      await ensureProjectHasNextcloudStorage('demo-project', page);
    } else {
      logInfo('Demo project Nextcloud storage already linked (API); skipping admin UI');
    }

    // NC→OP personal OAuth (API probe short-circuits when already connected).
    await page.context().clearCookies();
    await ensureOliverConnectedViaNextcloudPersonalSettings(page);

    await waitForNextcloudStorageHealthy('demo-project');
    await ensureOauth2AmpfWebDavAccess(OLIVER_OAUTH_USER, {
      projectFolder: ampProjectFolder,
    });

    if (!openProjectSession) {
      await page.context().clearCookies();
      // Callers that need OP use loginOpenProjectAsIntegrationUser / ensureFilesTab…
      return { homePage: new OpenProjectHomePage(page), user };
    }

    await page.context().clearCookies();
    const opLogin = new OpenProjectLoginPage(page);
    const oliverHome = await opLogin.login(
      OLIVER_OAUTH_USER.username,
      OLIVER_OAUTH_USER.password,
    );
    await oliverHome.waitForReady();
    return { homePage: oliverHome, user };
  }

  const homePage = await loginOpenProjectAsIntegrationUser(page);
  await ensureAliceIsDemoProjectMember();
  await ensureAliceAdminForCurrentSession(page, homePage);
  await homePage.waitForReady();
  await ensureProjectHasNextcloudStorage('demo-project', page);
  await waitForNextcloudStorageHealthy('demo-project');
  return { homePage, user };
}

/**
 * Click Files-tab "Nextcloud login" and return the page that shows the OAuth flow
 * (popup when opened, otherwise the same tab).
 */
export async function openNextcloudOAuthFromFilesTab(
  page: Page,
  filesTab: OpenProjectWorkPackageFilesTab,
): Promise<Page> {
  const hosts = resolveHosts();
  const ncHostPattern = hostUrlPattern(hosts.nextcloud);
  const popupPromise = page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await filesTab.clickNextcloudLogin();
  const popup = await popupPromise;
  const oauthPage = popup ?? page;

  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
  } else {
    await page.waitForURL(ncHostPattern, { timeout: 20000 });
  }

  return oauthPage;
}

/**
 * Complete Nextcloud storage OAuth (login → Grant → OP Authorize) and return to Files tab.
 */
export async function grantNextcloudOAuthFromFilesTab(
  page: Page,
  oauthPage: Page,
  filesTab: OpenProjectWorkPackageFilesTab,
  workPackageId: number,
  user: TestUser = integrationBrowserUser(),
): Promise<void> {
  const hosts = resolveHosts();
  const opHostPattern = hostUrlPattern(hosts.openproject);
  const isPopup = oauthPage !== page;

  const ncLogin = new NextcloudLoginPage(oauthPage);
  // NC storage OAuth: interstitial "Log in" → credentials → Grant access.
  const interstitial = await ncLogin.clickOAuthConnectLoginIfPrompted(10000);
  logInfo('Nextcloud OAuth interstitial Log in clicked: %s', interstitial);
  const loggedIn = await ncLogin.loginIfPrompted(user.username, user.password, 15000);
  logInfo('Nextcloud login form submitted: %s', loggedIn);
  // Fresh NC users show first-run wizard over the OAuth consent screen.
  if (loggedIn) {
    const dismissed = await ncLogin.dismissPostLoginOverlaysIfPresent(7000);
    logInfo('Nextcloud post-login overlays dismissed: %s', dismissed);
  }
  const granted = await ncLogin.grantAccessIfPrompted(20000);
  logInfo('Nextcloud Grant access clicked: %s', granted);

  const opLogin = new OpenProjectLoginPage(oauthPage);
  // After NC grant, OP asks to Authorize Nextcloud API access (same tab or popup).
  if (isPopup) {
    await Promise.race([
      oauthPage.waitForURL(opHostPattern, { timeout: 45000 }),
      oauthPage.waitForEvent('close', { timeout: 45000 }).then(() => null),
    ]).catch(() => null);
    if (!oauthPage.isClosed()) {
      const authorized = await opLogin.authorizeOAuthApplicationIfPrompted(20000);
      logInfo('OpenProject storage OAuth authorize clicked: %s', authorized);
      await oauthPage.waitForEvent('close', { timeout: 30000 }).catch(() => undefined);
    }
  } else {
    await page.waitForURL(opHostPattern, { timeout: 45000 });
    const authorized = await opLogin.authorizeOAuthApplicationIfPrompted(20000);
    logInfo('OpenProject storage OAuth authorize clicked: %s', authorized);
  }

  await filesTab.navigateToDemoProjectWorkPackageFiles(workPackageId);
  if (!filesTab.isOnDemoProjectWorkPackageFilesUrl()) {
    await filesTab.openWorkPackageFilesTab(20000);
  }

  // OAuth helpers used to return silently while Files still showed "Nextcloud login".
  const loginStillVisible = await filesTab
    .getNextcloudLoginButtonLocator()
    .isVisible()
    .catch(() => false);
  if (loginStillVisible) {
    throw new Error(
      'Files tab still shows Nextcloud login after storage OAuth; Grant/Authorize likely did not complete',
    );
  }
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
  // After NC-only browser steps, OP session is often gone — log in if redirected.
  const opLogin = new OpenProjectLoginPage(page);
  if (await opLogin.loginIfPrompted(user.username, user.password, 5000)) {
    await filesTab.navigateToDemoProjectWorkPackageFiles(workPackageId);
  }
  // OP 18 often keeps /work_packages/:id (Activity) even after a /files goto — open the Files tab.
  if (!filesTab.isOnDemoProjectWorkPackageFilesUrl()) {
    await filesTab.openWorkPackageFilesTab(20000);
  }

  const loginBtn = filesTab.getNextcloudLoginButtonLocator();
  const linkExisting = filesTab.getLocator('linkExistingFilesButton').first();
  const noConnection = filesTab.getLocator('filesTabNoConnectionError').first();

  // Files Nextcloud section loads async after the URL is ready — poll either outcome.
  // After NC app toggle, UI can briefly show "No Nextcloud connection" with neither control.
  let state: 'login' | 'connected' | null = null;
  let reloads = 0;
  await expect
    .poll(
      async () => {
        if (await linkExisting.isVisible().catch(() => false)) {
          state = 'connected';
          return true;
        }
        if (await loginBtn.isVisible().catch(() => false)) {
          state = 'login';
          return true;
        }
        if (reloads < 3 && (await noConnection.isVisible().catch(() => false))) {
          reloads += 1;
          logWarn(
            'Files tab shows No Nextcloud connection; soft-reloading (%s/3)',
            reloads,
          );
          await filesTab.navigateToDemoProjectWorkPackageFiles(workPackageId);
          if (!filesTab.isOnDemoProjectWorkPackageFilesUrl()) {
            await filesTab.openWorkPackageFilesTab(20000);
          }
        }
        return false;
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  if (state === 'login') {
    logInfo('Files tab shows Nextcloud login; completing storage OAuth as %s', user.username);
    const oauthPage = await openNextcloudOAuthFromFilesTab(page, filesTab);
    await grantNextcloudOAuthFromFilesTab(page, oauthPage, filesTab, workPackageId, user);
  }

  // Prefer the link-existing control (Nextcloud-specific) over generic attachment dropzone.
  await linkExisting.waitFor({ state: 'visible', timeout: 30000 });
  await filesTab.waitForNextcloudFilesSectionConnected(workPackageId);
}
