import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  OpenProjectAdminStoragesPage,
  OpenProjectHomePage,
  OpenProjectProjectStoragesPage,
} from '../../../pageobjects/openproject';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import { loginOpenProjectAsStorageAdmin } from '../shared';

const DEMO_PROJECT = 'demo-project';

test.describe('Teardown - Delete Nextcloud File Storage', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'Delete Nextcloud File Storage from OpenProject Admin',
    squashTestCase(2260, { stepCount: 5 }),
    async ({ page }) => {
      const homePage = new OpenProjectHomePage(page);
      const adminStorages = new OpenProjectAdminStoragesPage(page);
      const projectStorages = new OpenProjectProjectStoragesPage(page);

      await test.step(
        'Log in as Admin and navigate to Administration -> File storages',
        async () => {
          logInfo('TC-2260', 'Step 1: Logging in as storage admin and opening admin storages');
          try {
            await loginOpenProjectAsStorageAdmin(page);
            await homePage.waitForReady();
            await homePage.navigateToAdminStoragesSettings();
            await homePage.waitForAdminStoragesSettingsUrl();
          } catch (error: unknown) {
            logError('TC-2260', 'Step 1 failed:', getErrorMessage(error));
            throw error;
          }
        },
      );

      await test.step(
        'Locate the Nextcloud storage in the external file storages list',
        async () => {
          logInfo('TC-2260', 'Step 2: Asserting Nextcloud storage is listed');
          await expect(adminStorages.getLocator('adminStoragesNextcloudLink').first()).toBeVisible({
            timeout: 15000,
          });
        },
      );

      await test.step('Click Delete storage action button', async () => {
        logInfo('TC-2260', 'Step 3: Opening Nextcloud storage and clicking Delete');
        await adminStorages.openNextcloudStorage();
        await adminStorages.openDeleteStorageDialog();
        await expect(adminStorages.getLocator('adminStorageDestroyDialog').first()).toBeVisible({
          timeout: 15000,
        });
      });

      await test.step('Confirm deletion in the modal dialog', async () => {
        logInfo('TC-2260', 'Step 4: Confirming storage deletion in danger dialog');
        await adminStorages.confirmDeleteStorageDialog();
      });

      await test.step(
        'Verify Nextcloud storage is removed from storages table and no longer selectable in project settings',
        async () => {
          logInfo('TC-2260', 'Step 5: Asserting storage gone from admin list and Demo project');
          await expect(
            adminStorages.getLocator('adminStoragesNextcloudLink').first(),
          ).toBeHidden({ timeout: 30000 });

          await projectStorages.navigateToProjectStorages(DEMO_PROJECT);
          expect(await projectStorages.hasNextcloudStorage()).toBe(false);
        },
      );
    },
  );
});
