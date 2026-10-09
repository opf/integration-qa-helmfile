import { test, expect, integrationTags } from '../../base-test';
import { NextcloudLoginPage, NextcloudActiveAppsPage } from '../../../pageobjects/nextcloud';
import {
  OpenProjectLoginPage,
  OpenProjectHomePage,
  OpenProjectWorkPackageFilesTab,
} from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { ALICE_USER, NC_ADMIN_USER } from '../../../utils/test-users';
import {
  ensureProjectHasNextcloudStorage,
  waitForNextcloudStorageHealthy,
} from '../../../utils/test-helpers';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError, logWarn } from '../../../utils/logger';
import { testConfig } from '../../../utils/config';
import { shouldSkipMarketplaceInstall } from '../../../utils/integration-app-version';
import { ensureAliceAdminForCurrentSession } from '../shared';

const WORK_PACKAGE_ID = 2;

test.describe('SSO External - Installation & Upgrade', integrationTags, () => {
  test.describe.configure({ timeout: 600_000 });

  test(
    'Install Integration App via Marketplace',
    squashTestCase(2145, { stepCount: 3 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const activeAppsPage = new NextcloudActiveAppsPage(page);
      const opLoginPage = new OpenProjectLoginPage(page);
      const opHomePage = new OpenProjectHomePage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);

      // Prerequisite: Demo project linked so the post-check proves the link survives reinstall.
      logInfo('TC-2145', 'Setup: Ensuring Demo project Nextcloud storage as Alice');
      await opLoginPage.navigateTo();
      const keycloakLoginPage = await opLoginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      await opHomePage.waitForReady();
      await ensureAliceAdminForCurrentSession(page, opHomePage);
      await ensureProjectHasNextcloudStorage('demo-project', page);
      await waitForNextcloudStorageHealthy('demo-project');

      await test.step('Login to Nextcloud as an administrator', async () => {
        logInfo('TC-2145', 'Step 1: Logging in to Nextcloud as administrator');
        const dashboardPage = await loginPage.login(
          NC_ADMIN_USER.username,
          NC_ADMIN_USER.password,
        );
        await dashboardPage.waitForReady();
        expect(await dashboardPage.isLoggedIn()).toBe(true);
      });

      await test.step('Navigate to Apps - Integrations apps', async () => {
        logInfo('TC-2145', 'Step 2: Navigating to Integrations apps category');
        await activeAppsPage.navigateToIntegrationsApps();
        await activeAppsPage.waitForIntegrationsAppsReady();
      });

      await test.step(
        'Search for OpenProject Integration and click Download and enable',
        async () => {
          logInfo(
            'TC-2145',
            'Step 3: Remove preinstalled app if needed, then Download and enable from marketplace',
          );

          // Gate before any Remove: prefer live UI version (config/e2e-env.json can be stale).
          await activeAppsPage.findOpenProjectIntegrationApp();
          let deployedVersion = testConfig.nextcloud.integrationAppVersion;
          try {
            if (await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration()) {
              deployedVersion = await activeAppsPage.getOpenProjectIntegrationAppVersion();
            }
          } catch (error: unknown) {
            logWarn(
              'TC-2145',
              'Could not read live app version; using config:',
              deployedVersion,
              getErrorMessage(error),
            );
          }

          const skipGate = await shouldSkipMarketplaceInstall(deployedVersion);
          if (skipGate.skip) {
            logWarn('TC-2145', skipGate.reason);
            test.skip(true, skipGate.reason);
          }

          try {
            await activeAppsPage.removeOpenProjectIntegrationIfInstalled(
              NC_ADMIN_USER.password,
            );

            // Marketplace CTA may be a primary button or Actions → Download and force enable.
            await activeAppsPage.clickDownloadAndEnableOpenProjectIntegration(
              NC_ADMIN_USER.password,
            );

            await activeAppsPage.navigateTo();
            await activeAppsPage.waitForReady();
            await activeAppsPage.findOpenProjectIntegrationApp();
            expect(
              await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration(),
            ).toBe(true);

            await activeAppsPage.navigateToIntegrationsApps();
            await activeAppsPage.waitForIntegrationsAppsReady();
            await activeAppsPage.findOpenProjectIntegrationApp();
            expect(
              await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration(),
            ).toBe(true);
            logInfo(
              'TC-2145',
              'App installed via marketplace; Disable button present on Integrations list',
            );
          } finally {
            try {
              await activeAppsPage.ensureOpenProjectIntegrationEnabled(
                NC_ADMIN_USER.password,
              );
            } catch (error: unknown) {
              logError(
                'TC-2145',
                'Failed to ensure OpenProject Integration remains enabled:',
                getErrorMessage(error),
              );
              throw error;
            }
          }
        },
      );

      // Post-Squash checks (not extra steps): Nextcloud uninstall keeps app config,
      // so the existing integration must still work without any restore.
      logInfo('TC-2145', 'Post: Verifying Demo project storage and Files tab as Alice');
      await waitForNextcloudStorageHealthy('demo-project', { timeoutMs: 120_000 });
      await filesTab.navigateToDemoProjectWorkPackageFiles(WORK_PACKAGE_ID);
      await filesTab.waitForDemoProjectWorkPackageFilesUrl();
      await filesTab.waitForNextcloudFilesSectionConnected(WORK_PACKAGE_ID);
      logInfo('TC-2145', 'Post: OpenProject Files tab still connected after marketplace install');
    },
  );
});
