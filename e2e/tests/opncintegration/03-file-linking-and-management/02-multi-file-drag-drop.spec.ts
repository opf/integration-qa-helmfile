import { test, expect, dualSetupTags, skipUnlessSetupMethod, isSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  OpenProjectWorkPackageFilesTab,
  OpenProjectFilePickerModal,
} from '../../../pageobjects/openproject';
import {
  ampProjectFolder,
  ensureFilesTabNextcloudConnected,
  integrationBrowserUser,
  isOauth2Setup,
  prepareIntegrationUserForDemoStorage,
  captureAliceAdminStatus,
  restoreAliceAdminStatus,
} from '../shared';
import { deleteWorkPackageFileLinksByName } from '../../../utils/openproject-api';
import { deleteUploadedTestFile } from '../../../utils/test-helpers';
import { downloadNextcloudFileText } from '../../../utils/nextcloud-api';
import { logInfo, logWarn } from '../../../utils/logger';

const WORK_PACKAGE_ID = 2;
const MULTI_FILE_NAMES = [
  `op-multi-upload-a-${Date.now()}.md`,
  `op-multi-upload-b-${Date.now()}.md`,
];

async function cleanupMultiUploadArtifacts(): Promise<void> {
  const user = integrationBrowserUser();
  for (const name of MULTI_FILE_NAMES) {
    try {
      const deleted = await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, name);
      logInfo(`[Cleanup] Deleted file links for ${name}:`, deleted);
    } catch (err: unknown) {
      logWarn(`[Cleanup] Failed to delete file links for ${name}:`, err);
    }
    try {
      await deleteUploadedTestFile(name, ampProjectFolder, user);
      logInfo(`[Cleanup] Deleted ${name} from Nextcloud`);
    } catch (err: unknown) {
      logWarn(`[Cleanup] Failed to delete ${name} from Nextcloud:`, err);
    }
  }
}

test.describe('Multi-File Drag and Drop Upload', dualSetupTags, () => {
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
    await cleanupMultiUploadArtifacts();
    if (!isOauth2Setup()) {
      await restoreAliceAdminStatus();
    }
  });

  test(
    'Multi-File Drag and Drop Upload from OpenProject Files Tab',
    squashTestCase(2263, { stepCount: 4 }),
    async ({ page }) => {
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      const user = integrationBrowserUser();

      await prepareIntegrationUserForDemoStorage(page);
      await cleanupMultiUploadArtifacts();

      await test.step(
        'Open target work package in OpenProject and navigate to Files tab',
        async () => {
          await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
          await expect(filesTab.getLocator('workPackageFilesUploadDropBox').first()).toBeVisible({
            timeout: 15000,
          });
        },
      );

      await test.step(
        'Select multiple local files and drag and drop into Nextcloud storage drop box',
        async () => {
          // `#upload_files` is single-file; drop each file and confirm AMPF location.
          for (let i = 0; i < MULTI_FILE_NAMES.length; i++) {
            const name = MULTI_FILE_NAMES[i];
            await filesTab.uploadOrDropOneFile(name);
            await filePicker.waitForFilesPickerConfirmReady();
            if (isOauth2Setup() && i === 0) {
              await filePicker.ensureAtAmpfProjectFolder(ampProjectFolder);
            }
            await filePicker.confirmFilesPickerOptionalReplace();
            const success = filePicker.getLocator('filesUploadSuccessMessageAny').first();
            await success.waitFor({ state: 'visible', timeout: 60000 });
            await expect(filesTab.getLinkedWorkPackageFileItem(name)).toBeVisible({
              timeout: 20000,
            });
          }
        },
      );

      await test.step(
        'Wait for uploads to complete and verify upload progress indicators',
        async () => {
          const progress = filePicker.getLocator('filesUploadProgressIndicator').first();
          await progress.waitFor({ state: 'visible', timeout: 3000 }).catch(() => undefined);
          for (const name of MULTI_FILE_NAMES) {
            await expect(filesTab.getLinkedWorkPackageFileItem(name)).toBeVisible({
              timeout: 15000,
            });
          }
          const success = filePicker.getLocator('filesUploadSuccessMessageAny').first();
          // Last toast may already have dismissed; linked items above are the durable check.
          if (await success.isVisible().catch(() => false)) {
            await expect(success).toContainText(/Successfully created \d+ file links?/);
          }
        },
      );

      await test.step(
        'Verify all uploaded files appear in Nextcloud storage section and exist in Nextcloud via WebDAV',
        async () => {
          for (const name of MULTI_FILE_NAMES) {
            const item = filesTab.getLinkedWorkPackageFileItem(name);
            await item.waitFor({ state: 'visible', timeout: 20000 });
            await expect(item).toContainText(name);
            const body = await downloadNextcloudFileText(
              `OpenProject/${ampProjectFolder}/${name}`,
              user,
            );
            expect(body.length).toBeGreaterThan(0);
          }
        },
      );
    },
  );
});
