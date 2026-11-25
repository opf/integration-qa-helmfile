
import { test, expect, ssoExternalTags, skipUnlessSetupMethod } from '../../base-test';
import { NextcloudActiveAppsPage, NextcloudDashboardPage } from '../../../pageobjects/nextcloud';
import { squashTestCase } from '../../../utils/squash-metadata';
import { logInfo } from '../../../utils/logger';
import { loginNextcloudAsAdmin } from '../shared';

test.describe('SSO External - App Health', ssoExternalTags, () => {
  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external');
  });
  test(
    'should login to Nextcloud and verify OpenProject Integration app',
    squashTestCase(2167, { stepCount: 5 }),
    async ({ page }) => {
      let activeAppsPage: NextcloudActiveAppsPage;

      await test.step(
        'Open Nextcloud login page (/login) and log in as administrator',
        async () => {
          await loginNextcloudAsAdmin(page);
          const dashboardPage = new NextcloudDashboardPage(page);
          await dashboardPage.waitForReady();
          expect(await dashboardPage.isLoggedIn()).toBe(true);
        },
      );

      await test.step(
        'Navigate to Installed/Active Apps administration page (/settings/apps/enabled)',
        async () => {
          activeAppsPage = new NextcloudActiveAppsPage(page);
          await activeAppsPage.navigateTo();
          await activeAppsPage.waitForReady();
        },
      );

      await test.step(
        'Locate the OpenProject Integration app entry in the active apps list',
        async () => {
          await activeAppsPage.findOpenProjectIntegrationApp();
        },
      );

      await test.step(
        'Inspect the OpenProject Integration app title link and version label',
        async () => {
          const appVersion = await activeAppsPage.getOpenProjectIntegrationAppVersion();
          logInfo('[TEST RESULT] OpenProject Integration App Version: %s', appVersion);
          const appLink = activeAppsPage.getOpenProjectIntegrationAppLink();
          await expect(appLink).toBeVisible();
          expect(appVersion).toBeTruthy();
          expect(appVersion.length).toBeGreaterThan(0);
          logInfo('[TEST RESULT] Verified App Version: %s', appVersion);
        },
      );

      await test.step(
        'Verify the presence of the "Disable" button for the OpenProject Integration app',
        async () => {
          const isDisableButtonPresent =
            await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration();
          expect(isDisableButtonPresent).toBe(true);
          logInfo('[TEST RESULT] Disable Button Present: %s', isDisableButtonPresent);
        },
      );
    },
  );
});
