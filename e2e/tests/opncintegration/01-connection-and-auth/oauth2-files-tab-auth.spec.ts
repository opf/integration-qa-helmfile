import { Page } from '@playwright/test';
import { test, expect, oauth2Tags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
} from '../../../pageobjects/nextcloud';
import {
  OpenProjectLoginPage,
  OpenProjectWorkPackageFilesTab,
} from '../../../pageobjects/openproject';
import { OLIVER_OAUTH_USER, OP_ADMIN_USER } from '../../../utils/test-users';
import { ensureNextcloudLocalUser } from '../../../utils/nextcloud-api';
import {
  ensureOpenProjectLocalUser,
  ensureUserIsProjectMember,
} from '../../../utils/openproject-api';
import { ensureProjectHasNextcloudStorage } from '../../../utils/test-helpers';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import { resolveHosts } from '../../../utils/env-hosts';
import { hostUrlPattern } from '../../../utils/url-helpers';
import {
  grantNextcloudOAuthFromFilesTab,
  openNextcloudOAuthFromFilesTab,
} from '../shared';

const WORK_PACKAGE_ID = 2;
const DEMO_PROJECT = 'demo-project';

test.describe('Connection & Auth - OAuth2 Files Tab Authorization', oauth2Tags, () => {
  test.describe.configure({ timeout: 300_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('oauth2');
  });

  test(
    '[oauth2] Authorize Nextcloud connection from OpenProject Files tab',
    squashTestCase(2227, { stepCount: 4 }),
    async ({ page }) => {
      const opLoginPage = new OpenProjectLoginPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const ncLoginPage = new NextcloudLoginPage(page);
      const personalSettingsPage = new NextcloudPersonalSettingsPage(page);
      const hosts = resolveHosts();
      let oauthPage: Page = page;

      // Prerequisites (not Squash steps): Oliver provisioned, Demo storage linked,
      // NC→OP disconnected + OP→NC OAuth client tokens revoked so Files shows login.
      logInfo('TC-2227', 'Setup: provisioning Oliver and ensuring disconnected Files-tab state');
      try {
        await Promise.all([
          ensureOpenProjectLocalUser(OLIVER_OAUTH_USER),
          ensureNextcloudLocalUser(OLIVER_OAUTH_USER),
        ]);
        await ensureUserIsProjectMember(OLIVER_OAUTH_USER.username, DEMO_PROJECT, 'Member');

        // Disconnect NC→OP first (fresh NC session), then link storage as admin.
        const dashboard = await ncLoginPage.login(
          OLIVER_OAUTH_USER.username,
          OLIVER_OAUTH_USER.password,
        );
        await dashboard.waitForReady();
        await personalSettingsPage.navigateTo();
        await personalSettingsPage.waitForReady();
        if (await personalSettingsPage.isConnected(500)) {
          logInfo('TC-2227', 'Oliver connected in NC personal settings; disconnecting');
          await personalSettingsPage.disconnectOpenProject();
        }
        await page.context().clearCookies();

        const adminHome = await opLoginPage.login(OP_ADMIN_USER.username, OP_ADMIN_USER.password);
        await adminHome.waitForReady();
        await ensureProjectHasNextcloudStorage(DEMO_PROJECT, page);
        await page.context().clearCookies();

        // Two-way OAuth: NC personal disconnect leaves OP→NC tokens; revoke so Files prompts.
        const oliverHome = await opLoginPage.login(
          OLIVER_OAUTH_USER.username,
          OLIVER_OAUTH_USER.password,
        );
        await oliverHome.waitForReady();
        const revoked = await oliverHome.revokeOAuthClientTokensIfPresent();
        logInfo('TC-2227', 'Revoked %s OP OAuth client token(s) before Files-tab auth', revoked);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2227', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Log in to OpenProject as the test user and navigate to a work package',
        async () => {
          logInfo('TC-2227', 'Step 1: Logging in as Oliver and opening WP #%s', WORK_PACKAGE_ID);
          const home = await opLoginPage.login(
            OLIVER_OAUTH_USER.username,
            OLIVER_OAUTH_USER.password,
          );
          await home.waitForReady();
          await filesTab.navigateToDemoProjectWorkPackage(WORK_PACKAGE_ID);
          await filesTab.waitForDemoProjectWorkPackageUrl();
        },
      );

      await test.step('Open the Files tab', async () => {
        logInfo('TC-2227', 'Step 2: Opening Files tab and waiting for Nextcloud login prompt');
        await filesTab.openWorkPackageFilesTab();
        await filesTab.waitForNextcloudLoginPrompt(60000);
        await expect(filesTab.getStorageLoginPromptLocator()).toBeVisible();
        await expect(filesTab.getNextcloudLoginButtonLocator()).toBeVisible();
      });

      await test.step('Click "Nextcloud login" button', async () => {
        logInfo('TC-2227', 'Step 3: Clicking Nextcloud login to start storage OAuth');
        oauthPage = await openNextcloudOAuthFromFilesTab(page, filesTab);
        await expect(oauthPage).toHaveURL(hostUrlPattern(hosts.nextcloud), { timeout: 20000 });
      });

      await test.step('Authorize access in Nextcloud and return to OpenProject', async () => {
        logInfo('TC-2227', 'Step 4: Granting Nextcloud access and verifying Files tab connected');
        await grantNextcloudOAuthFromFilesTab(
          page,
          oauthPage,
          filesTab,
          WORK_PACKAGE_ID,
          OLIVER_OAUTH_USER,
        );
        const linkExisting = filesTab.getLocator('linkExistingFilesButton').first();
        await expect(linkExisting).toBeVisible({ timeout: 30000 });
        await filesTab.waitForNextcloudFilesSectionConnected(WORK_PACKAGE_ID);
      });
    },
  );
});
