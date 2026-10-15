import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudAdminSettingsPage,
} from '../../../pageobjects/nextcloud';
import { NC_ADMIN_USER } from '../../../utils/test-users';
import { logInfo, logError } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/error-utils';

test.describe('Installation - Nextcloud Admin OpenProject Settings', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'Nextcloud Admin Settings for OpenProject & AMPF Verification',
    squashTestCase(2253, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const adminSettings = new NextcloudAdminSettingsPage(page);

      await test.step(
        'Log in to Nextcloud as admin and navigate to Administration Settings -> OpenProject',
        async () => {
          logInfo('TC-2253', 'Step 1: Login as NC admin and open OpenProject admin settings');
          try {
            const dashboard = await loginPage.login(
              NC_ADMIN_USER.username,
              NC_ADMIN_USER.password,
            );
            await dashboard.waitForReady();
            expect(await dashboard.isLoggedIn()).toBe(true);
            await adminSettings.navigateTo();
            await adminSettings.waitForReady();
          } catch (error: unknown) {
            logError('TC-2253', 'Step 1 failed:', getErrorMessage(error));
            throw error;
          }
        },
      );

      await test.step(
        'Verify OpenProject connection section displays configured host URL and green connected status badge',
        async () => {
          logInfo('TC-2253', 'Step 2: Verifying OpenProject host and connected badge');
          await adminSettings.verifyHostConfigured();
        },
      );

      await test.step(
        'Inspect Authentication method section and verify configured method',
        async () => {
          logInfo('TC-2253', 'Step 3: Verifying authentication method');
          await adminSettings.verifyAuthMethodConfigured();
        },
      );

      await test.step(
        'Inspect Automatically managed project folders section and verify groupfolders setup and status',
        async () => {
          logInfo('TC-2253', 'Step 4: Verifying project folders / AMPF section');
          await adminSettings.verifyProjectFoldersConfigured();
        },
      );
    },
  );
});
