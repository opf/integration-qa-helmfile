import { test, expect, dualSetupTags, skipUnlessSetupMethod, isSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import { OpenProjectAdminStoragesPage, OpenProjectHomePage } from '../../../pageobjects/openproject';
import {
  captureAliceAdminStatus,
  isOauth2Setup,
  loginOpenProjectAsStorageAdmin,
  restoreAliceAdminStatus,
} from '../shared';

test.describe('Storage Health Check', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.beforeAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    if (!isOauth2Setup()) {
      await captureAliceAdminStatus();
    }
  });

  test.afterAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    if (!isOauth2Setup()) {
      await restoreAliceAdminStatus();
    }
  });

  test(
    'Verify Nextcloud Storage Health Check Status and Notifications',
    squashTestCase(2261, { stepCount: 5 }),
    async ({ page }) => {
      const adminStorages = new OpenProjectAdminStoragesPage(page);
      let homePage: OpenProjectHomePage;

      // Squash prerequisite: admin session (not a counted step).
      homePage = await loginOpenProjectAsStorageAdmin(page);

      await test.step('Navigate to Administration -> File storages in OpenProject', async () => {
        await homePage.navigateToAdminStoragesSettings();
        await homePage.waitForAdminStoragesSettingsUrl();
        await expect(adminStorages.getLocator('adminStoragesNextcloudLink').first()).toBeVisible();
      });

      await test.step(
        'Inspect the storage health status pill for the configured Nextcloud storage',
        async () => {
          await adminStorages.openNextcloudStorage();
          // AMPF sidebar shows Label--success "Healthy" after sync; list may omit it.
          await adminStorages.expectHealthyStatusPill();
          await expect(adminStorages.getLocator('storageHealthPill').first()).toContainText(
            /Healthy/i,
          );
        },
      );

      await test.step('Trigger manual storage health verification probe', async () => {
        await adminStorages.runHealthChecksNow();
      });

      await test.step(
        'Verify health status updates and confirms connection reachability',
        async () => {
          // On the full report page after re-run, reachability is shown as Passed checks.
          await expect(adminStorages.getLocator('storageHealthLastCheckText').first()).toBeVisible({
            timeout: 15000,
          });
          const hostOk = adminStorages.getLocator('storageHealthHostAccessible').first();
          const allPassed = adminStorages.getLocator('storageHealthChecksPassed').first();
          const passed = adminStorages.getLocator('storageHealthPassedLabel').first();
          await expect
            .poll(
              async () => {
                if (await hostOk.isVisible().catch(() => false)) return 'host';
                if (await allPassed.isVisible().catch(() => false)) return 'all';
                if (await passed.isVisible().catch(() => false)) return 'passed';
                return null;
              },
              { timeout: 15000 },
            )
            .not.toBeNull();
        },
      );

      await test.step(
        'Verify no error banners or unhealthy notifications are shown',
        async () => {
          await adminStorages.expectNoUnhealthyNotifications();
          await expect(adminStorages.getLocator('storageHealthUnhealthyPill').first()).toHaveCount(0);
        },
      );
    },
  );
});
