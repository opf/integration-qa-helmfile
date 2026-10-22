import { test, expect, oauth2Tags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  OpenProjectHomePage,
  OpenProjectLoginPage,
  OpenProjectWorkPackageFilesTab,
} from '../../../pageobjects/openproject';
import { OLIVER_OAUTH_USER } from '../../../utils/test-users';
import {
  deleteOpenProjectStorageOAuthTokens,
  isKubectlAvailable,
} from '../../../utils/openproject-oauth-tokens';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import {
  DEMO_WORK_PACKAGE_ID,
  ensureFilesTabNextcloudConnected,
  prepareIntegrationUserForDemoStorage,
} from '../shared';

test.describe('OAuth Re-Authentication on Revoked Token', oauth2Tags, () => {
  test.describe.configure({ timeout: 360_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('oauth2');
  });

  test(
    'OAuth Re-Authentication Prompt on Revoked Refresh Token',
    squashTestCase(2269, { stepCount: 2 }),
    async ({ page }) => {
      const opLogin = new OpenProjectLoginPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      let homePage: OpenProjectHomePage;

      logInfo('TC-2269', 'Setup: prepare Oliver connected Files-tab session');
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await page.context().clearCookies();
        homePage = await opLogin.login(
          OLIVER_OAUTH_USER.username,
          OLIVER_OAUTH_USER.password,
        );
        await homePage.waitForReady();
        await filesTab.navigateToDemoProjectWorkPackage(DEMO_WORK_PACKAGE_ID);
        await filesTab.openWorkPackageFilesTabIfNeeded();
        await ensureFilesTabNextcloudConnected(
          page,
          filesTab,
          DEMO_WORK_PACKAGE_ID,
          OLIVER_OAUTH_USER,
        );
      } catch (error: unknown) {
        logError('TC-2269', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Revoke the OAuth refresh token on Nextcloud side (or delete token record in personal settings)',
        async () => {
          logInfo('TC-2269', 'Step 1: Revoking OP→NC OAuth client tokens');
          let revoked = await homePage.revokeOAuthClientTokensIfPresent();
          if (revoked === 0) {
            // Access-tokens UI can omit rows while DB tokens still authorize Files tab.
            if (!(await isKubectlAvailable())) {
              test.skip(
                true,
                'kubectl unavailable — UI found no client tokens; delete requires cluster rails runner',
              );
            }
            revoked = await deleteOpenProjectStorageOAuthTokens(OLIVER_OAUTH_USER.username);
          }
          expect(revoked).toBeGreaterThan(0);
        },
      );

      await test.step(
        'Reload OpenProject WP Files tab and verify the user is gracefully prompted with Login to Nextcloud button',
        async () => {
          logInfo('TC-2269', 'Step 2: Reloading Files tab expecting Nextcloud login prompt');
          await filesTab.navigateToDemoProjectWorkPackageFiles(DEMO_WORK_PACKAGE_ID);
          await filesTab.openWorkPackageFilesTabIfNeeded();
          await filesTab.waitForNextcloudLoginPrompt(60000);
          await expect(filesTab.getStorageLoginPromptLocator()).toBeVisible();
          await expect(filesTab.getNextcloudLoginButtonLocator()).toBeVisible();
        },
      );
    },
  );
});
