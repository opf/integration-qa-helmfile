import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { NextcloudLoginPage, NextcloudActiveAppsPage } from '../../../pageobjects/nextcloud';
import { OpenProjectWorkPackageFilesTab } from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { NC_ADMIN_USER } from '../../../utils/test-users';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError, logWarn } from '../../../utils/logger';
import {
  compareVersionCores,
  fetchLatestMarketplaceIntegrationAppVersion,
  isUnstableIntegrationAppVersion,
} from '../../../utils/integration-app-version';
import {
  ensureFilesTabNextcloudConnected,
  integrationBrowserUser,
  isOauth2Setup,
  loginOpenProjectAsIntegrationUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';
import { waitForNextcloudStorageHealthy } from '../../../utils/test-helpers';

const WORK_PACKAGE_ID = 2;

test.describe('Installation & Upgrade - App Upgrade', dualSetupTags, () => {
  test.describe.configure({ timeout: 600_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'Integration app can be upgraded to the latest version',
    squashTestCase(2146, { stepCount: 2 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const activeAppsPage = new NextcloudActiveAppsPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const user = integrationBrowserUser();

      let marketplaceVersion: string | null = null;

      // Prerequisite (not a Squash step): Demo project linked so the post-check proves
      // the link survives the upgrade. Mirrors TC-2145 marketplace install setup.
      logInfo(
        'TC-2146',
        'Setup: Ensuring Demo project Nextcloud storage as %s (%s)',
        user.username,
        isOauth2Setup() ? 'oauth2' : 'sso-external',
      );
      let homePage = await loginOpenProjectAsIntegrationUser(page);
      const prepared = await prepareIntegrationUserForDemoStorage(page, homePage);
      homePage = prepared.homePage;
      await homePage.waitForReady();

      await test.step(
        'Obtain and install an older release (e.g., version 2.11.2) of the integration app from GitHub releases OR install via helm setup',
        async () => {
          logInfo('TC-2146', 'Step 1: Logging in to Nextcloud and noting deployed app version');
          await page.context().clearCookies();
          const dashboardPage = await loginPage.login(
            NC_ADMIN_USER.username,
            NC_ADMIN_USER.password,
          );
          await dashboardPage.waitForReady();
          expect(await dashboardPage.isLoggedIn()).toBe(true);

          await activeAppsPage.navigateTo();
          await activeAppsPage.waitForReady();
          await activeAppsPage.findOpenProjectIntegrationApp();

          const deployedVersion = await activeAppsPage.getOpenProjectIntegrationAppVersion();
          logInfo('TC-2146', `Current deployed integration app version: ${deployedVersion}`);
          expect(deployedVersion).toBeTruthy();

          if (isUnstableIntegrationAppVersion(deployedVersion)) {
            const reason = `Deployed app ${deployedVersion} is a nightly/git/dev build; cannot test marketplace upgrade`;
            logWarn('TC-2146', reason);
            test.skip(true, reason);
          }

          marketplaceVersion = await fetchLatestMarketplaceIntegrationAppVersion();
          logInfo(
            'TC-2146',
            `Marketplace latest release version: ${marketplaceVersion ?? 'unknown'}`,
          );

          if (!marketplaceVersion) {
            const reason =
              'Could not fetch marketplace latest release version from GitHub; skipping upgrade test';
            logWarn('TC-2146', reason);
            test.skip(true, reason);
          }

          const cmp = compareVersionCores(deployedVersion, marketplaceVersion!);
          if (cmp === null) {
            const reason = `Could not parse version cores for deployed (${deployedVersion}) or marketplace (${marketplaceVersion})`;
            logWarn('TC-2146', reason);
            test.skip(true, reason);
          }

          if (cmp! >= 0) {
            const reason = `Deployed version (${deployedVersion}) is >= marketplace version (${marketplaceVersion}); upgrade test requires older deployed version`;
            logWarn('TC-2146', reason);
            test.skip(true, reason);
          }

          logInfo(
            'TC-2146',
            `Version check passed: deployed ${deployedVersion} < marketplace ${marketplaceVersion}. Proceeding with upgrade test.`,
          );
        },
      );

      await test.step('Confirm that the app functions and note the version', async () => {
        logInfo('TC-2146', 'Step 2: Triggering upgrade and verifying app functions');
        try {
          expect(
            await activeAppsPage.isUpdateButtonPresentForOpenProjectIntegration(),
          ).toBe(true);

          await activeAppsPage.clickUpdateOpenProjectIntegration(NC_ADMIN_USER.password);

          await activeAppsPage.navigateTo();
          await activeAppsPage.waitForReady();
          await activeAppsPage.findOpenProjectIntegrationApp();

          expect(
            await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration(),
          ).toBe(true);

          const newVersion = await activeAppsPage.getOpenProjectIntegrationAppVersion();
          logInfo('TC-2146', `Integration app version after upgrade: ${newVersion}`);
          expect(marketplaceVersion).toBeTruthy();
          expect(compareVersionCores(newVersion, marketplaceVersion!)).toBe(0);
        } finally {
          try {
            await activeAppsPage.ensureOpenProjectIntegrationEnabled(
              NC_ADMIN_USER.password,
            );
          } catch (error: unknown) {
            logError('TC-2146', 'Failed to ensure app remains enabled:', getErrorMessage(error));
            throw error;
          }
        }

        // Post-Squash checks (not extra steps): storage healthy and Files tab connected.
        logInfo('TC-2146', 'Post: Verifying OpenProject storage and Files tab');
        await waitForNextcloudStorageHealthy('demo-project', { timeoutMs: 120_000 });
        await page.context().clearCookies();
        homePage = await loginOpenProjectAsIntegrationUser(page);
        await homePage.waitForReady();
        await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
        logInfo('TC-2146', 'Post: Files tab connected successfully');
      });
    },
  );
});
