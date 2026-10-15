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
  deleteWorkPackage,
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

const TIMESTAMP = Date.now();
const TEST_FILE_NAME = `nc-create-wp-${TIMESTAMP}.txt`;
const TEST_FILE_CONTENT = `Create WP test file created at ${new Date().toISOString()}\n`;
const CREATED_WP_SUBJECT = `Created from Nextcloud ${TIMESTAMP}`;
let createdWorkPackageId: number | undefined;

test.describe('Work Package Integration - Create WP from Nextcloud', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterAll(async () => {
    const user = integrationBrowserUser();
    if (createdWorkPackageId) {
      try {
        await deleteWorkPackage(createdWorkPackageId);
        logInfo('TC-2246', 'Cleaned up created work package #%s', createdWorkPackageId);
      } catch (err: unknown) {
        logInfo('TC-2246', 'Cleanup WP error:', getErrorMessage(err));
      }
    }
    try {
      await deleteNextcloudFile(TEST_FILE_NAME, user);
    } catch (err: unknown) {
      logInfo('TC-2246', 'Cleanup file error:', getErrorMessage(err));
    }
  });

  test(
    'Create Work Package Directly from Nextcloud File Panel',
    squashTestCase(2246, { stepCount: 4 }),
    async ({ page }) => {
      const ncLoginPage = new NextcloudLoginPage(page);
      const filesPage = new NextcloudFilesPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const user = integrationBrowserUser();

      logInfo('TC-2246', 'Setup: uploading test file %s', TEST_FILE_NAME);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await uploadNextcloudFile(TEST_FILE_NAME, TEST_FILE_CONTENT, user);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2246', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Open File Details sidebar for target file -> click OpenProject tab',
        async () => {
          logInfo('TC-2246', 'Step 1: Logging in to Nextcloud and opening details sidebar');
          await ncLoginPage.login(user.username, user.password);
          await filesPage.navigateToFiles();
          await filesPage.waitForReady();
          await filesPage.openFileDetailsSidebar(TEST_FILE_NAME);
          await filesPage.openSidebarOpenProjectTab();
          await expect(filesPage.getLocator('filesSidebarOpenProjectView').first()).toBeVisible();
        },
      );

      await test.step('Click + Create work package button', async () => {
        logInfo('TC-2246', 'Step 2: Opening Create Work Package modal');
        await filesPage.openCreateWorkPackageModal();
        await expect(filesPage.getLocator('createWorkPackageModal').first()).toBeVisible({ timeout: 15000 });
      });

      await test.step(
        'Select Project (Demo project), Type (Task), enter Subject, Description, and click Create',
        async () => {
          logInfo('TC-2246', 'Step 3: Filling and submitting Create Work Package form');
          await filesPage.createWorkPackageFromModal({
            project: 'Demo project',
            subject: CREATED_WP_SUBJECT,
            type: 'Task',
            description: 'Automated test work package created from Nextcloud sidebar',
          });
          // Verify modal closes
          await expect(filesPage.getLocator('createWorkPackageModal').first()).toBeHidden({ timeout: 15000 });
        },
      );

      await test.step(
        'Verify in Nextcloud sidebar and OpenProject',
        async () => {
          logInfo('TC-2246', 'Step 4: Verifying newly created WP is displayed in NC sidebar and OP Files tab');
          const linkedItem = filesPage.getLinkedWorkPackageItem(CREATED_WP_SUBJECT);
          await expect(linkedItem).toBeVisible({ timeout: 20000 });

          createdWorkPackageId = await filesPage.getLinkedWorkPackageId(CREATED_WP_SUBJECT);
          logInfo('TC-2246', 'Discovered created work package ID: #%s', createdWorkPackageId);

          const homePage = new OpenProjectHomePage(page);
          await homePage.navigateTo();
          await filesTab.navigateToDemoProjectWorkPackage(createdWorkPackageId);
          await filesTab.openWorkPackageFilesTab();
          await ensureFilesTabNextcloudConnected(page, filesTab, createdWorkPackageId, user);
          const opLinkedFile = filesTab.getLinkedWorkPackageFileItem(TEST_FILE_NAME);
          await expect(opLinkedFile).toBeVisible({ timeout: 20000 });
        },
      );
    },
  );
});
