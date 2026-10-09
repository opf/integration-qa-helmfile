import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { NextcloudLoginPage, NextcloudActiveAppsPage } from '../../../pageobjects/nextcloud';
import { OpenProjectWorkPackageFilesTab } from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { NC_ADMIN_USER } from '../../../utils/test-users';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import {
  ensureFilesTabNextcloudConnected,
  integrationBrowserUser,
  isOauth2Setup,
  loginOpenProjectAsIntegrationUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';

const WORK_PACKAGE_ID = 2;

test.describe('Installation & Upgrade - Enable App', dualSetupTags, () => {
  test.describe.configure({ timeout: 240_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'Enable Integration App via Nextcloud UI',
    squashTestCase(2147, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const activeAppsPage = new NextcloudActiveAppsPage(page);

      await test.step('Login to Nextcloud as an administrator', async () => {
        logInfo('TC-2147', 'Step 1: Logging in to Nextcloud as administrator');
        const dashboardPage = await loginPage.login(
          NC_ADMIN_USER.username,
          NC_ADMIN_USER.password,
        );
        await dashboardPage.waitForReady();
        expect(await dashboardPage.isLoggedIn()).toBe(true);
      });

      await test.step('Navigate to Profile - Apps - Integration', async () => {
        logInfo('TC-2147', 'Step 2: Navigating to Active Apps administration page');
        await activeAppsPage.navigateTo();
        await activeAppsPage.waitForReady();
      });

      await test.step('Locate the OpenProject Integration', async () => {
        logInfo('TC-2147', 'Step 3: Locating OpenProject Integration app');
        await activeAppsPage.findOpenProjectIntegrationApp();
        const appLink = activeAppsPage.getOpenProjectIntegrationAppLink();
        await expect(appLink).toBeVisible();
      });

      await test.step('Click Enable', async () => {
        logInfo('TC-2147', 'Step 4: Disable→Enable cycle and verify enabled state');
        try {
          const wasEnabled =
            await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration();

          if (wasEnabled) {
            logInfo('TC-2147', 'App is enabled; disabling to exercise Enable');
            await activeAppsPage.clickDisableOpenProjectIntegration();
          }

          await activeAppsPage.navigateToDisabledApps();
          await activeAppsPage.waitForDisabledAppsReady();
          await activeAppsPage.findOpenProjectIntegrationApp();
          expect(await activeAppsPage.isEnableButtonPresentForOpenProjectIntegration()).toBe(
            true,
          );

          await activeAppsPage.clickEnableOpenProjectIntegration(NC_ADMIN_USER.password);
          await activeAppsPage.navigateTo();
          await activeAppsPage.waitForReady();
          await activeAppsPage.findOpenProjectIntegrationApp();
          expect(await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration()).toBe(
            true,
          );
          logInfo('TC-2147', 'App re-enabled; Disable button present on Active apps');
        } finally {
          try {
            await activeAppsPage.ensureOpenProjectIntegrationEnabled(NC_ADMIN_USER.password);
          } catch (error: unknown) {
            logError(
              'TC-2147',
              'Failed to ensure OpenProject Integration remains enabled:',
              getErrorMessage(error),
            );
            throw error;
          }
        }
      });

      // Post-Squash checks (not extra steps): Demo project storage healthy and Files tab connected.
      const user = integrationBrowserUser();
      logInfo(
        'TC-2147',
        'Post: Verifying Demo project storage and Files tab as %s (%s)',
        user.username,
        isOauth2Setup() ? 'oauth2' : 'sso-external',
      );
      await page.context().clearCookies();
      let homePage = await loginOpenProjectAsIntegrationUser(page);
      const prepared = await prepareIntegrationUserForDemoStorage(page, homePage);
      homePage = prepared.homePage;
      await homePage.waitForReady();

      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
      logInfo('TC-2147', 'Post: OpenProject Files tab still connected after enable cycle');
    },
  );
});
