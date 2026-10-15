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
const TIMESTAMP = Date.now();
const BULK_FILES = [
  `bulk-link-1-${TIMESTAMP}.txt`,
  `bulk-link-2-${TIMESTAMP}.txt`,
];

test.describe('Work Package Integration - Nextcloud Bulk File Link', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterAll(async () => {
    const user = integrationBrowserUser();
    for (const fileName of BULK_FILES) {
      try {
        await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, fileName);
      } catch (err: unknown) {
        logInfo('TC-2245', 'Cleanup link error for %s:', fileName, getErrorMessage(err));
      }
      try {
        await deleteNextcloudFile(fileName, user);
      } catch (err: unknown) {
        logInfo('TC-2245', 'Cleanup file error for %s:', fileName, getErrorMessage(err));
      }
    }
  });

  test(
    'Bulk Link Multiple Nextcloud Files to Work Package',
    squashTestCase(2245, { stepCount: 4 }),
    async ({ page }) => {
      const ncLoginPage = new NextcloudLoginPage(page);
      const filesPage = new NextcloudFilesPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const user = integrationBrowserUser();

      logInfo('TC-2245', 'Setup: uploading multiple files for bulk linking: %o', BULK_FILES);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        for (const fileName of BULK_FILES) {
          await uploadNextcloudFile(fileName, `Content for ${fileName}\n`, user);
        }
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2245', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'In Nextcloud Files list, select checkboxes for multiple files',
        async () => {
          logInfo('TC-2245', 'Step 1: Logging in to Nextcloud and selecting bulk files');
          await ncLoginPage.login(user.username, user.password, {
            redirectPath: '/index.php/apps/files/files',
          });
          await filesPage.waitForReady();
          await filesPage.selectMultipleFiles(BULK_FILES);
        },
      );

      await test.step(
        'Click top Actions dropdown -> Link to OpenProject work package',
        async () => {
          logInfo('TC-2245', 'Step 2: Clicking Link to work package action');
          await filesPage.clickLinkToWorkPackage();
          await expect(
            filesPage.getLocator('filesLinkToWorkPackageModalHeading').first(),
          ).toBeVisible({ timeout: 15000 });
        },
      );

      await test.step(
        'In modal, select target project from dropdown and search/select target work package, then click Link files',
        async () => {
          logInfo('TC-2245', 'Step 3: Searching and selecting WP #%s in bulk link modal', WORK_PACKAGE_ID);
          await filesPage.linkWorkPackagesInBulkModal(WORK_PACKAGE_ID);
          await filesPage.waitForBulkLinkSuccess();
        },
      );

      await test.step(
        'Open the target work package in OpenProject -> Files tab',
        async () => {
          logInfo('TC-2245', 'Step 4: Verifying all bulk linked files appear in OpenProject WP Files tab');
          await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
          for (const fileName of BULK_FILES) {
            const item = filesTab.getLinkedWorkPackageFileItem(fileName);
            await expect(item).toBeVisible({ timeout: 15000 });
          }
        },
      );
    },
  );
});
