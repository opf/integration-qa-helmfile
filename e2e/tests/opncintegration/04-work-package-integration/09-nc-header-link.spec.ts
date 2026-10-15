import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
  NextcloudHeaderPage,
  NextcloudFilesPage,
} from '../../../pageobjects/nextcloud';
import {
  integrationBrowserUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';
import { logInfo, logError } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/error-utils';

test.describe('Work Package Integration - Nextcloud Header OpenProject Link', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'Top Header Navigation Icon Link from Nextcloud to OpenProject',
    squashTestCase(2250, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const personalSettings = new NextcloudPersonalSettingsPage(page);
      const header = new NextcloudHeaderPage(page);
      const filesPage = new NextcloudFilesPage(page);
      const user = integrationBrowserUser();

      logInfo('TC-2250', 'Setup: preparing integration user %s', user.username);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2250', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step('Navigate to Nextcloud Personal Settings -> OpenProject', async () => {
        logInfo('TC-2250', 'Step 1: Login and open personal OpenProject settings');
        await loginPage.login(user.username, user.password, {
          redirectPath: '/index.php/settings/user/openproject',
        });
        await personalSettings.waitForReady();
      });

      await test.step('Ensure Enable navigation link checkbox is checked', async () => {
        logInfo('TC-2250', 'Step 2: Enabling navigation link preference');
        await personalSettings.toggleNavigationLink(true);
        expect(await personalSettings.isNavigationLinkEnabled()).toBe(true);
        // Navigation entry is registered on page load — reload so it appears in the app menu.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await personalSettings.waitForReady();
        expect(await personalSettings.isNavigationLinkEnabled()).toBe(true);
      });

      await test.step(
        'Inspect top header navigation bar and verify OpenProject icon is visible',
        async () => {
          logInfo('TC-2250', 'Step 3: Verifying OpenProject header icon');
          await filesPage.navigateToFiles();
          await filesPage.waitForReady();
          await header.verifyOpenProjectHeaderVisible();
        },
      );

      await test.step(
        'Click OpenProject header icon and verify navigation to configured OpenProject instance URL',
        async () => {
          logInfo('TC-2250', 'Step 4: Clicking header icon and asserting OP redirect');
          await header.clickOpenProjectHeaderAndAssertRedirect();
        },
      );
    },
  );
});
