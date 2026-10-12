import { test, expect, dualSetupTags, skipUnlessSetupMethod, isSetupMethod } from '../../base-test';
import {
  OpenProjectWorkPackageFilesTab,
  OpenProjectFilePickerModal,
} from '../../../pageobjects/openproject';
import {
  uploadedFileName,
  keepBothSiblingPattern,
  replacedFileBody,
  ampProjectFolder,
  cleanupCollisionArtifacts,
  captureAliceAdminStatus,
  restoreAliceAdminStatus,
  dualSetupSquashCase,
  isOauth2Setup,
  prepareIntegrationUserForDemoStorage,
  loginOpenProjectAsIntegrationUser,
  ensureFilesTabNextcloudConnected,
  integrationBrowserUser,
} from '../shared';
import { deleteWorkPackageFileLinksByName } from '../../../utils/openproject-api';
import { downloadNextcloudFileText } from '../../../utils/nextcloud-api';
import { logInfo } from '../../../utils/logger';

const WORK_PACKAGE_ID = 2;

const uploadSquash = dualSetupSquashCase(
  { id: 2068, title: 'Upload a file from OP to NC using ampf' },
  {
    id: 2230,
    title:
      '[oauth2] Link and upload files in automatically managed project folder in Nextcloud',
  },
  5,
);

const actionsSquash = dualSetupSquashCase(
  {
    id: 2148,
    title: 'OpenProject Files tab lists linked Nextcloud items and available actions',
  },
  {
    id: 2233,
    title:
      '[oauth2] OpenProject Files tab lists linked Nextcloud items and available actions',
  },
  4,
);

const replaceSquash = dualSetupSquashCase(
  { id: 2163, title: 'File Upload Name Collision - Replace Existing File' },
  { id: 2231, title: '[oauth2] File Upload Name Collision - Replace Existing File' },
  4,
);

const keepBothSquash = dualSetupSquashCase(
  { id: 2164, title: 'File Upload Name Collision - Keep Both Files' },
  { id: 2232, title: '[oauth2] File Upload Name Collision - Keep Both Files' },
  4,
);

test.describe('Files Tab Management', dualSetupTags, () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.beforeAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    if (!isOauth2Setup()) {
      await captureAliceAdminStatus();
    }
  });

  test(
    uploadSquash.title,
    uploadSquash.details,
    async ({ page }) => {
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);

      // First serial test: full connect (oauth2 NC↔OP + Files OAuth / SSO Alice setup).
      logInfo('Files-tab upload', 'Setup: prepare integration user for current SETUP_METHOD');
      await prepareIntegrationUserForDemoStorage(page);
      await cleanupCollisionArtifacts();
      await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, uploadedFileName);

      await test.step('Open target work package Files tab in OpenProject', async () => {
        await ensureFilesTabNextcloudConnected(
          page,
          filesTab,
          WORK_PACKAGE_ID,
          integrationBrowserUser(),
        );
      });

      await test.step(
        'Click "Upload files" in the Nextcloud section and select a file from local computer',
        async () => {
          await filePicker.openFilesPickerWithUpload(uploadedFileName);
          await filePicker.waitForFilesPickerReady(uploadedFileName);
          await expect(filePicker.getLocator('filesPickerModal')).toBeVisible();
          if (isOauth2Setup()) {
            await filePicker.ensureAtAmpfProjectFolder(ampProjectFolder);
          }
        },
      );

      await test.step('Confirm upload location (Choose location)', async () => {
        await filePicker.confirmFilesPickerOptionalReplace();
      });

      await test.step('Wait for the upload to complete', async () => {
        const uploadSuccessMessage = filePicker.getLocator('filesUploadSuccessMessage');
        await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
        await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');
      });

      await test.step(
        'Verify the uploaded file appears in the Nextcloud section of the Files tab',
        async () => {
          const linkedFileItem = filesTab.getLinkedWorkPackageFileItem(uploadedFileName);
          await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });
          await expect(linkedFileItem).toContainText(uploadedFileName);
        },
      );
    },
  );

  test(
    actionsSquash.title,
    actionsSquash.details,
    async ({ page }) => {
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const user = integrationBrowserUser();

      await test.step('Log in to OpenProject as the test user', async () => {
        logInfo('Files-tab actions', 'Step 1: Logging in as %s', user.username);
        await loginOpenProjectAsIntegrationUser(page);
      });

      await test.step('Open the target work package', async () => {
        await filesTab.navigateToDemoProjectWorkPackage(WORK_PACKAGE_ID);
        await filesTab.waitForDemoProjectWorkPackageUrl();
      });

      await test.step('Open the Files tab', async () => {
        await filesTab.openWorkPackageFilesTab();
        await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
        const fileItem = filesTab.getLinkedWorkPackageFileItem(uploadedFileName);
        await fileItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(fileItem).toContainText(uploadedFileName);
      });

      await test.step('Hover over a linked file and verify available actions', async () => {
        await filesTab.hoverLinkedWorkPackageFile(uploadedFileName);
        await expect(filesTab.getLinkedWorkPackageFileDownloadAction(uploadedFileName)).toBeVisible();
        await expect(
          filesTab.getLinkedWorkPackageFileOpenLocationAction(uploadedFileName),
        ).toBeVisible();
        await expect(
          filesTab.getLinkedWorkPackageFileRemoveLinkAction(uploadedFileName),
        ).toBeVisible();
      });
    },
  );

  test(
    replaceSquash.title,
    replaceSquash.details,
    async ({ page }) => {
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      const user = integrationBrowserUser();

      await loginOpenProjectAsIntegrationUser(page);
      await cleanupCollisionArtifacts();
      await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
      await filePicker.seedAmpfUpload(uploadedFileName);

      await test.step('Open target work package Files tab in OpenProject', async () => {
        await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
        const seedItem = filesTab.getLinkedWorkPackageFileItem(uploadedFileName);
        await seedItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(seedItem).toContainText(uploadedFileName);
      });

      await test.step(
        'Click "Upload files" and select a file with an already existing name',
        async () => {
          await filePicker.openFilesPickerWithUpload(uploadedFileName, replacedFileBody);
          await filePicker.waitForFilesPickerReady(uploadedFileName);
          await expect(filePicker.getLocator('filesPickerModal')).toBeVisible();
          if (isOauth2Setup()) {
            await filePicker.ensureAtAmpfProjectFolder(ampProjectFolder);
          }
        },
      );

      await test.step('Confirm upload location', async () => {
        await filePicker.confirmFilesPickerExpectingCollision();
      });

      await test.step('Click "Replace"', async () => {
        await filePicker.chooseFileCollisionAction('replace');
        await expect(filePicker.getLocator('existingFileModalTitle')).toBeHidden({ timeout: 20000 });
        await expect
          .poll(() => filesTab.countLinkedWorkPackageFiles(uploadedFileName), { timeout: 15000 })
          .toBe(1);
        // oauth2 OP→NC direct-download links often expire; assert body via WebDAV instead.
        await expect
          .poll(
            async () => {
              if (isOauth2Setup()) {
                const body = await downloadNextcloudFileText(
                  `OpenProject/${ampProjectFolder}/${uploadedFileName}`,
                  user,
                );
                return body.includes('collision-replace-marker');
              }
              return (
                await filesTab.downloadLinkedWorkPackageFileText(uploadedFileName)
              ).includes('collision-replace-marker');
            },
            { timeout: 20000 },
          )
          .toBe(true);
      });
    },
  );

  test(
    keepBothSquash.title,
    keepBothSquash.details,
    async ({ page }) => {
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      const user = integrationBrowserUser();

      await loginOpenProjectAsIntegrationUser(page);
      await cleanupCollisionArtifacts();
      await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
      await filePicker.seedAmpfUpload(uploadedFileName);

      await test.step('Open target work package Files tab in OpenProject', async () => {
        await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
        const seedItem = filesTab.getLinkedWorkPackageFileItem(uploadedFileName);
        await seedItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(seedItem).toContainText(uploadedFileName);
      });

      await test.step(
        'Click "Upload files" and select a file named as an already uploaded',
        async () => {
          await filePicker.openFilesPickerWithUpload(uploadedFileName);
          await filePicker.waitForFilesPickerReady(uploadedFileName);
          await expect(filePicker.getLocator('filesPickerModal')).toBeVisible();
          if (isOauth2Setup()) {
            await filePicker.ensureAtAmpfProjectFolder(ampProjectFolder);
          }
        },
      );

      await test.step('Confirm upload location', async () => {
        await filePicker.confirmFilesPickerExpectingCollision();
      });

      await test.step('Click "Keep both"', async () => {
        await filePicker.chooseFileCollisionAction('keepBoth');
        const uploadSuccessMessage = filePicker.getLocator('filesUploadSuccessMessage');
        await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
        await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');
        const originalItem = filesTab.getLinkedWorkPackageFileItem(uploadedFileName);
        await originalItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(originalItem).toContainText(uploadedFileName);
        const siblingItem = filesTab.getLinkedWorkPackageFileItemMatching(keepBothSiblingPattern);
        await siblingItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(siblingItem).toContainText(keepBothSiblingPattern);
      });
    },
  );

  test.afterAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    await cleanupCollisionArtifacts();
    if (!isOauth2Setup()) {
      await restoreAliceAdminStatus();
    }
  });
});
