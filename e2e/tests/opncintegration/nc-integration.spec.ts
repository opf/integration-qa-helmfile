import { test, expect, integrationTags } from '../base-test';
import { NextcloudLoginPage, NextcloudActiveAppsPage, NextcloudOpenIDConnectPage } from '../../pageobjects/nextcloud';
import { squashTestCase } from '../../utils/squash-metadata';
import { NC_ADMIN_USER } from '../../utils/test-users';
import { logInfo } from '../../utils/logger';

test.describe('SSO External - Nextcloud Integration', integrationTags, () => {
  test(
    'should login to Nextcloud and verify Keycloak provider details',
    squashTestCase(2166, { stepCount: 3 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      let openIdConnectPage: NextcloudOpenIDConnectPage;

      await test.step(
        'Open Nextcloud login page (/login) and log in as administrator (admin / admin)',
        async () => {
          const dashboardPage = await loginPage.login(
            NC_ADMIN_USER.username,
            NC_ADMIN_USER.password,
          );
          await dashboardPage.waitForReady();
          expect(await dashboardPage.isLoggedIn()).toBe(true);
        },
      );

      await test.step(
        'Navigate to the OpenID Connect admin settings page (/settings/admin/user_oidc)',
        async () => {
          openIdConnectPage = new NextcloudOpenIDConnectPage(page);
          await openIdConnectPage.navigateTo();
          await openIdConnectPage.waitForReady();
        },
      );

      await test.step(
        'Locate the Keycloak provider section (h3 title "Keycloak") and verify provider details',
        async () => {
          const areProviderDetailsPresent =
            await openIdConnectPage.verifyKeycloakProviderDetails();
          expect(areProviderDetailsPresent).toBe(true);
        },
      );
    },
  );

  test(
    'should login to Nextcloud and verify OpenProject Integration app',
    squashTestCase(2167, { stepCount: 5 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      let activeAppsPage: NextcloudActiveAppsPage;

      await test.step(
        'Open Nextcloud login page (/login) and log in as administrator',
        async () => {
          const dashboardPage = await loginPage.login(
            NC_ADMIN_USER.username,
            NC_ADMIN_USER.password,
          );
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
