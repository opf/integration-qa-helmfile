import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudFilesPage,
} from '../../../pageobjects/nextcloud';
import {
  OpenProjectWorkPackageFilesTab,
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

const TEST_FILE_CONTENT = `Create WP test file created at ${new Date().toISOString()}\n`;
let createdWorkPackageId: number | undefined;
let testFileName = '';
let createdWpSubject = '';

test.describe('Work Package Integration - Create WP from Nextcloud', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterEach(async () => {
    const user = integrationBrowserUser();
    if (createdWorkPackageId) {
      try {
        await deleteWorkPackage(createdWorkPackageId);
        logInfo('TC-2246', 'Cleaned up created work package #%s', createdWorkPackageId);
      } catch (err: unknown) {
        logInfo('TC-2246', 'Cleanup WP error:', getErrorMessage(err));
      }
      createdWorkPackageId = undefined;
    }
    if (testFileName) {
      try {
        await deleteNextcloudFile(testFileName, user);
      } catch (err: unknown) {
        logInfo('TC-2246', 'Cleanup file error:', getErrorMessage(err));
      }
    }
  });

  test(
    'Create Work Package Directly from Nextcloud File Panel',
    squashTestCase(2246, { stepCount: 4 }),
    async ({ page }) => {
      const timestamp = Date.now();
      testFileName = `nc-create-wp-${timestamp}.txt`;
      createdWpSubject = `Created from Nextcloud ${timestamp}`;
      const ncLoginPage = new NextcloudLoginPage(page);
      const filesPage = new NextcloudFilesPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const user = integrationBrowserUser();

      logInfo('TC-2246', 'Setup: uploading test file %s', testFileName);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await uploadNextcloudFile(testFileName, TEST_FILE_CONTENT, user);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2246', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Open File Details sidebar for target file -> click OpenProject tab',
        async () => {
          logInfo('TC-2246', 'Step 1: Logging in to Nextcloud and opening details sidebar');
          await ncLoginPage.login(user.username, user.password, {
            redirectPath: '/index.php/apps/files/files',
          });
          await filesPage.waitForReady();
          await filesPage.openFileDetailsSidebar(testFileName);
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
            subject: createdWpSubject,
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
          const linkedItem = filesPage.getLinkedWorkPackageItem(createdWpSubject);
          await expect(linkedItem).toBeVisible({ timeout: 20000 });

          createdWorkPackageId = await filesPage.getLinkedWorkPackageId(createdWpSubject);
          logInfo('TC-2246', 'Discovered created work package ID: #%s', createdWorkPackageId);

          await ensureFilesTabNextcloudConnected(page, filesTab, createdWorkPackageId, user);
          const opLinkedFile = filesTab.getLinkedWorkPackageFileItem(testFileName);
          await expect(opLinkedFile).toBeVisible({ timeout: 20000 });
        },
      );
    },
  );
});
