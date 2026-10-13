import { test, expect, oauth2Tags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
  NextcloudFilesPage,
} from '../../../pageobjects/nextcloud';
import { OLIVER_OAUTH_USER } from '../../../utils/test-users';
import {
  ensureNextcloudLocalUser,
  ensureOauth2AmpfWebDavAccess,
} from '../../../utils/nextcloud-api';
import {
  ensureOpenProjectLocalUser,
  ensureUserIsProjectMember,
} from '../../../utils/openproject-api';
import { ensureProjectHasNextcloudStorage } from '../../../utils/test-helpers';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import { ampProjectFolder, ensureOliverConnectedViaNextcloudPersonalSettings } from '../shared';

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
      const filesPage = new NextcloudFilesPage(page);

      // Prerequisites: Oliver connected NC→OP so disconnect has effect; Demo storage linked.
      logInfo('TC-2162', 'Setup: provisioning Oliver Oauth and ensuring NC→OP connected');
      try {
        await ensureOpenProjectLocalUser(OLIVER_OAUTH_USER);
        await ensureUserIsProjectMember(OLIVER_OAUTH_USER.username, DEMO_PROJECT, 'Member');
        await ensureNextcloudLocalUser(OLIVER_OAUTH_USER);
        await ensureProjectHasNextcloudStorage(DEMO_PROJECT, undefined);
        // AMPF team folder must be visible so step 4 can Link-to-WP after disconnect.
        await ensureOauth2AmpfWebDavAccess(OLIVER_OAUTH_USER, {
          projectFolder: ampProjectFolder,
        });
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

      await test.step(
        'Open Files, select an OpenProject project folder, and link to a work package',
        async () => {
          logInfo(
            'TC-2162',
            'Step 4: Verifying NC Link-to-WP shows no connection after personal disconnect',
          );
          await filesPage.navigateToFiles();
          await filesPage.waitForReady();
          await filesPage.openFolder('OpenProject');
          await filesPage.selectFolder(ampProjectFolder);
          await filesPage.clickLinkToWorkPackage();
          await filesPage.waitForNoConnectionModal(20000);
          await expect(filesPage.getNoConnectionTextLocator()).toBeVisible();
          await expect(filesPage.getModalConnectButtonLocator()).toBeVisible();
        },
      );
    },
  );
});
