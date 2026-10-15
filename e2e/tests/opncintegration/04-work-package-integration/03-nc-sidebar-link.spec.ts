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
const TEST_FILE_NAME = `nc-sidebar-link-${Date.now()}.txt`;
const TEST_FILE_CONTENT = `Sidebar link test file created at ${new Date().toISOString()}\n`;

test.describe('Work Package Integration - Nextcloud Sidebar Linking', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterAll(async () => {
    const user = integrationBrowserUser();
    try {
      await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, TEST_FILE_NAME);
    } catch (err: unknown) {
      logInfo('TC-2244', 'Cleanup link error:', getErrorMessage(err));
    }
    try {
      await deleteNextcloudFile(TEST_FILE_NAME, user);
    } catch (err: unknown) {
      logInfo('TC-2244', 'Cleanup file error:', getErrorMessage(err));
    }
  });

  test(
    'Link Work Package from Nextcloud File Details Sidebar',
    squashTestCase(2244, { stepCount: 4 }),
    async ({ page }) => {
      const ncLoginPage = new NextcloudLoginPage(page);
      const filesPage = new NextcloudFilesPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const user = integrationBrowserUser();

      logInfo('TC-2244', 'Setup: ensuring user session and uploading test file %s', TEST_FILE_NAME);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await uploadNextcloudFile(TEST_FILE_NAME, TEST_FILE_CONTENT, user);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2244', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'In Nextcloud Files app, locate target file, click context menu -> Details',
        async () => {
          logInfo('TC-2244', 'Step 1: Logging in to Nextcloud and opening file details sidebar');
          await ncLoginPage.login(user.username, user.password);
          await filesPage.navigateToFiles();
          await filesPage.waitForReady();
          await filesPage.openFileDetailsSidebar(TEST_FILE_NAME);
        },
      );

      await test.step('Click OpenProject tab in the details sidebar', async () => {
        logInfo('TC-2244', 'Step 2: Activating OpenProject sidebar tab');
        await filesPage.openSidebarOpenProjectTab();
        await expect(filesPage.getLocator('filesSidebarOpenProjectView').first()).toBeVisible();
      });

      await test.step(
        'In the work package search field, type the work package ID or subject and select it from dropdown',
        async () => {
          logInfo('TC-2244', 'Step 3: Searching and linking WP #%s', WORK_PACKAGE_ID);
          await filesPage.linkWorkPackageFromSidebar(WORK_PACKAGE_ID);
          const isLinked = await filesPage.hasLinkedWorkPackage(WORK_PACKAGE_ID);
          expect(isLinked).toBe(true);
        },
      );

      await test.step(
        'Switch to OpenProject, open work package #2, and navigate to Files tab',
        async () => {
          logInfo('TC-2244', 'Step 4: Verifying link appears in OpenProject WP Files tab');
          const homePage = new OpenProjectHomePage(page);
          await homePage.navigateTo();
          await filesTab.navigateToDemoProjectWorkPackage(WORK_PACKAGE_ID);
          await filesTab.openWorkPackageFilesTab();
          await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
          const linkedItem = filesTab.getLinkedWorkPackageFileItem(TEST_FILE_NAME);
          await expect(linkedItem).toBeVisible({ timeout: 20000 });
        },
      );
    },
  );
});
