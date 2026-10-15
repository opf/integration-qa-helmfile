import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudFilesPage,
} from '../../../pageobjects/nextcloud';
import {
  OpenProjectWorkPackageFilesTab,
  OpenProjectHomePage,
} from '../../../pageobjects/openproject';
import {
  deleteWorkPackageFileLinksByName,
} from '../../../utils/openproject-api';
import {
  uploadNextcloudFile,
  deleteNextcloudFile,
} from '../../../utils/nextcloud-api';
import { logInfo, logError } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/error-utils';
import {
  ensureFilesTabNextcloudConnected,
  integrationBrowserUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';

const WORK_PACKAGE_ID = 2;
const TEST_FILE_NAME = `nc-sidebar-unlink-${Date.now()}.txt`;
const TEST_FILE_CONTENT = `Sidebar unlink test file created at ${new Date().toISOString()}\n`;

test.describe('Work Package Integration - Nextcloud Sidebar Unlink', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterAll(async () => {
    const user = integrationBrowserUser();
    try {
      await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, TEST_FILE_NAME);
    } catch (err: unknown) {
      logInfo('TC-2251', 'Cleanup link error:', getErrorMessage(err));
    }
    try {
      await deleteNextcloudFile(TEST_FILE_NAME, user);
    } catch (err: unknown) {
      logInfo('TC-2251', 'Cleanup file error:', getErrorMessage(err));
    }
  });

  test(
    'Unlink Work Package from Nextcloud File Details Sidebar',
    squashTestCase(2251, { stepCount: 4 }),
    async ({ page }) => {
      const ncLoginPage = new NextcloudLoginPage(page);
      const filesPage = new NextcloudFilesPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const user = integrationBrowserUser();

      logInfo('TC-2251', 'Setup: ensuring user session, uploading test file and linking WP');
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await uploadNextcloudFile(TEST_FILE_NAME, TEST_FILE_CONTENT, user);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2251', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'In Nextcloud Files, open File Details for linked file -> click OpenProject tab',
        async () => {
          logInfo('TC-2251', 'Step 1: Logging in to Nextcloud, opening details sidebar and OpenProject tab');
          await ncLoginPage.login(user.username, user.password);
          await filesPage.navigateToFiles();
          await filesPage.waitForReady();
          await filesPage.openFileDetailsSidebar(TEST_FILE_NAME);
          await filesPage.openSidebarOpenProjectTab();
          // Pre-link if not yet linked
          const isLinked = await filesPage.hasLinkedWorkPackage(WORK_PACKAGE_ID);
          if (!isLinked) {
            await filesPage.linkWorkPackageFromSidebar(WORK_PACKAGE_ID);
          }
          await expect(filesPage.getLocator('filesSidebarLinkedWorkPackages').first()).toBeVisible();
        },
      );

      await test.step('Click Unlink icon next to the work package card', async () => {
        logInfo('TC-2251', 'Step 2: Clicking Unlink icon next to WP #%s', WORK_PACKAGE_ID);
        const item = page.locator(`#workpackage-${WORK_PACKAGE_ID}, .linked-workpackages--workpackage:has-text("#${WORK_PACKAGE_ID}")`).first();
        await expect(item).toBeVisible({ timeout: 15000 });
        const unlinkBtn = item.locator('.linked-workpackages--workpackage--unlinkactionbutton, button').first();
        await unlinkBtn.waitFor({ state: 'visible', timeout: 10000 });
        await unlinkBtn.click();
      });

      await test.step('Confirm unlinking in modal', async () => {
        logInfo('TC-2251', 'Step 3: Confirming unlinking action');
        const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Unlink")').first();
        if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmBtn.click();
        }
        const item = page.locator(`#workpackage-${WORK_PACKAGE_ID}, .linked-workpackages--workpackage:has-text("#${WORK_PACKAGE_ID}")`).first();
        await expect(item).toBeHidden({ timeout: 15000 });
      });

      await test.step(
        'Switch to OpenProject -> Work Package Files tab',
        async () => {
          logInfo('TC-2251', 'Step 4: Verifying file is no longer listed in OpenProject WP Files tab');
          const homePage = new OpenProjectHomePage(page);
          await homePage.navigateTo();
          await filesTab.navigateToDemoProjectWorkPackage(WORK_PACKAGE_ID);
          await filesTab.openWorkPackageFilesTab();
          await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
          const count = await filesTab.countLinkedWorkPackageFiles(TEST_FILE_NAME);
          expect(count).toBe(0);
        },
      );
    },
  );
});
