import { test, expect, oauth2Tags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  OpenProjectHomePage,
  OpenProjectLoginPage,
  OpenProjectWorkPackageFilesTab,
} from '../../../pageobjects/openproject';
import { OLIVER_OAUTH_USER } from '../../../utils/test-users';
import { expireOpenProjectStorageAccessTokens } from '../../../utils/openproject-oauth-tokens';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import {
  DEMO_WORK_PACKAGE_ID,
  ensureFilesTabNextcloudConnected,
  prepareIntegrationUserForDemoStorage,
} from '../shared';

test.describe('OAuth Access Token Silent Refresh', oauth2Tags, () => {
  test.describe.configure({ timeout: 360_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('oauth2');
  });

  test(
    'Expired OAuth Access Token Silent Refresh Flow',
    squashTestCase(2258, { stepCount: 4 }),
    async ({ page }) => {
      const opLogin = new OpenProjectLoginPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      let homePage: OpenProjectHomePage;

      logInfo('TC-2258', 'Setup: prepare Oliver + Demo storage');
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2258', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Establish active OpenProject session with connected Nextcloud OAuth2 storage',
        async () => {
          logInfo('TC-2258', 'Step 1: Login Oliver and connect Files tab');
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
          await filesTab.waitForNextcloudFilesSectionConnected(DEMO_WORK_PACKAGE_ID);
        },
      );

      await test.step(
        'Simulate or expire the access token (or advance expiry timestamp)',
        async () => {
          logInfo('TC-2258', 'Step 2: Expiring OAuthClientToken access for Oliver');
          const count = await expireOpenProjectStorageAccessTokens(OLIVER_OAUTH_USER.username);
          expect(count).toBeGreaterThan(0);
        },
      );

      await test.step(
        'Trigger a file operation in OpenProject Files tab requiring Nextcloud communication',
        async () => {
          logInfo('TC-2258', 'Step 3: Reloading Files tab to force NC communication');
          await filesTab.navigateToDemoProjectWorkPackageFiles(DEMO_WORK_PACKAGE_ID);
          await filesTab.openWorkPackageFilesTabIfNeeded();
          // Click Link existing files to exercise storage API with expired access token.
          const linkExisting = filesTab.getLocator('linkExistingFilesButton').first();
          if (await linkExisting.isVisible({ timeout: 10000 }).catch(() => false)) {
            await linkExisting.click();
            const modal = filesTab.getLocator('filesPickerModal').first();
            await modal.waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
            await page.keyboard.press('Escape').catch(() => undefined);
          }
        },
      );

      await test.step(
        'Verify the operation succeeds seamlessly via silent token refresh without prompting user to re-login',
        async () => {
          logInfo('TC-2258', 'Step 4: Asserting no Nextcloud login prompt after refresh');
          const loginPrompt = filesTab.getStorageLoginPromptLocator();
          await expect(loginPrompt).toBeHidden({ timeout: 10000 });
          await filesTab.waitForNextcloudFilesSectionConnected(DEMO_WORK_PACKAGE_ID, {
            timeoutMs: 60_000,
          });
        },
      );
    },
  );
});
