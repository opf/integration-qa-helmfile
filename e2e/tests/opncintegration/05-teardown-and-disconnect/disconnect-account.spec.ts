import { test, expect, oauth2Tags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
} from '../../../pageobjects/nextcloud';
import {
  OpenProjectLoginPage,
  OpenProjectHomePage,
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
import { ensureOliverConnectedViaNextcloudPersonalSettings } from '../shared';

const WORK_PACKAGE_ID = 2;
const DEMO_PROJECT = 'demo-project';

test.describe('Teardown & Disconnect - OAuth2 Account Disconnection', oauth2Tags, () => {
  test.describe.configure({ timeout: 300_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('oauth2');
  });

  test(
    '[oauth2] Disconnect Nextcloud Account from Nextcloud User Settings',
    squashTestCase(2162, { stepCount: 4 }),
    async ({ page }) => {
      const ncLoginPage = new NextcloudLoginPage(page);
      const personalSettingsPage = new NextcloudPersonalSettingsPage(page);
      const opLoginPage = new OpenProjectLoginPage(page);
      const opHomePage = new OpenProjectHomePage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);

      // ── Prerequisites (not Squash steps) ──────────────────────────────
      logInfo('TC-2162', 'Setup: provisioning Oliver Oauth and Demo project storage');
      try {
        await ensureOpenProjectLocalUser(OLIVER_OAUTH_USER);
        await ensureUserIsProjectMember(OLIVER_OAUTH_USER.username, DEMO_PROJECT, 'Member');
        await ensureNextcloudLocalUser(OLIVER_OAUTH_USER);

        // Link Nextcloud storage to Demo project (oauth2 setup-job may omit this).
        const adminHome = await opLoginPage.login(OP_ADMIN_USER.username, OP_ADMIN_USER.password);
        await adminHome.waitForReady();
        await ensureProjectHasNextcloudStorage(DEMO_PROJECT, page);
        await page.context().clearCookies();

        await ensureOliverConnectedViaNextcloudPersonalSettings(page);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2162', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step('Log in to Nextcloud as the test user', async () => {
        logInfo('TC-2162', 'Step 1: Logging in to Nextcloud as Oliver Oauth');
        const dashboard = await ncLoginPage.login(
          OLIVER_OAUTH_USER.username,
          OLIVER_OAUTH_USER.password,
        );
        await dashboard.waitForReady();
        expect(await dashboard.isLoggedIn()).toBe(true);
      });

      await test.step('Navigate to Settings -> OpenProject', async () => {
        logInfo('TC-2162', 'Step 2: Navigating to Nextcloud Settings → OpenProject');
        await personalSettingsPage.navigateTo();
        await personalSettingsPage.waitForReady();
        expect(await personalSettingsPage.isConnected()).toBe(true);
      });

      await test.step('Click "Disconnect from OpenProject" button', async () => {
        logInfo('TC-2162', 'Step 3: Disconnecting OpenProject from Nextcloud personal settings');
        await personalSettingsPage.disconnectOpenProject();
        await expect(
          personalSettingsPage.getLocator('ncPersonalSettingsConnectButton').first(),
        ).toBeVisible();
      });

      await test.step('Switch to OpenProject and open a work package Files tab', async () => {
        logInfo('TC-2162', 'Step 4: Verifying OpenProject Files tab prompts for Nextcloud login');
        await page.context().clearCookies();
        const home = await opLoginPage.login(
          OLIVER_OAUTH_USER.username,
          OLIVER_OAUTH_USER.password,
        );
        await home.waitForReady();
        await opHomePage.dismissLanguageSelectionModalIfPresent();
        await opHomePage.dismissTutorialOverlayIfPresent();

        await filesTab.navigateToDemoProjectWorkPackageFiles(WORK_PACKAGE_ID);
        await filesTab.waitForDemoProjectWorkPackageFilesUrl();
        await filesTab.waitForNextcloudLoginPrompt(60000);
        await expect(filesTab.getStorageLoginPromptLocator()).toBeVisible();
        await expect(filesTab.getNextcloudLoginButtonLocator()).toBeVisible();
      });
    },
  );
});
