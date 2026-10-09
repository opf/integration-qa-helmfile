import { test, expect, dualSetupTags, skipUnlessSetupMethod, isSetupMethod } from '../../base-test';
import {
  OpenProjectWorkPackageFilesTab,
  OpenProjectFilePickerModal,
} from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { deleteWorkPackageFileLinksByName } from '../../../utils/openproject-api';
import { deleteNextcloudFile, seedAmpfFolderWithFile } from '../../../utils/nextcloud-api';
import { logInfo } from '../../../utils/logger';
import {
  ampProjectFolder,
  ensureFilesTabNextcloudConnected,
  integrationBrowserUser,
  isOauth2Setup,
  loginOpenProjectAsIntegrationUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';

const WORK_PACKAGE_ID = 2;
const SEED_FOLDER = 'tc-2165';
const SEEDED_FILE = 'delete.md';
const SEEDED_FILE_PATH = `OpenProject/${ampProjectFolder}/${SEED_FOLDER}/${SEEDED_FILE}`;

test.describe('Work Package Integration - Deleted Files Handling', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, SEEDED_FILE);
  });

  test(
    'Display and Handle Deleted Nextcloud Files in Files Tab',
    squashTestCase(2165, { stepCount: 5 }),
    async ({ page }) => {
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      const user = integrationBrowserUser();

      // Prerequisites (not Squash steps): login, membership, storage, Files tab connected.
      logInfo(
        'TC-2165',
        'Setup: Logging in as %s (%s)',
        user.username,
        isOauth2Setup() ? 'local oauth2' : 'Keycloak SSO',
      );
      let homePage = await loginOpenProjectAsIntegrationUser(page);
      const prepared = await prepareIntegrationUserForDemoStorage(page, homePage);
      homePage = prepared.homePage;
      await homePage.waitForReady();
      await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, SEEDED_FILE);

      await filesTab.navigateToDemoProjectWorkPackage(WORK_PACKAGE_ID);
      await filesTab.waitForDemoProjectWorkPackageUrl();
      await filesTab.openWorkPackageFilesTab();
      await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);

      await test.step('Log in to Nextcloud and upload file delete.md', async () => {
        logInfo('TC-2165', 'Step 1: Seeding %s via WebDAV AMPF helper', SEEDED_FILE_PATH);
        await seedAmpfFolderWithFile({
          projectFolder: ampProjectFolder,
          folderName: SEED_FOLDER,
          fileName: SEEDED_FILE,
          user,
          content: `# ${SEEDED_FILE}\nSeeded for TC-2165 deleted-files handling.\n`,
        });
      });

      await test.step(
        'Link the file to the Openproject work package from the Nextcloud',
        async () => {
          logInfo('TC-2165', 'Step 2: Linking %s to WP #%s via file picker', SEEDED_FILE, WORK_PACKAGE_ID);
          await filePicker.openLinkExistingFilesPicker();
          await filePicker.waitForLinkPickerReady();
          await expect(filePicker.getLocator('filesPickerModal')).toBeVisible();

          await filePicker.navigateIntoFolder(SEED_FOLDER);
          await expect(
            filePicker.getLocator('filesPickerBreadcrumb').filter({ hasText: SEED_FOLDER }).first()
          ).toBeVisible();
          await expect(
            filePicker.getLocator('filesPickerListItem').filter({ hasText: SEEDED_FILE }).first()
          ).toBeVisible();

          await filePicker.selectFileInPicker(SEEDED_FILE);
          await filePicker.confirmLinkSelection();

          const uploadSuccessMessage = filePicker.getLocator('filesUploadSuccessMessage');
          await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
          await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');

          const linkedFileItem = filesTab.getLinkedWorkPackageFileItem(SEEDED_FILE);
          await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });
          await expect(linkedFileItem).toContainText(SEEDED_FILE);
        }
      );

      await test.step('Delete the file from the Nextcloud', async () => {
        logInfo('TC-2165', 'Step 3: Deleting %s from Nextcloud via WebDAV', SEEDED_FILE_PATH);
        await deleteNextcloudFile(SEEDED_FILE_PATH, user);
      });

      await test.step(
        'Switch back to OpenProject, go to the work package and open the Files tab',
        async () => {
          logInfo('TC-2165', 'Step 4: Reloading WP #%s Files tab', WORK_PACKAGE_ID);
          await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
        }
      );

      await test.step('Verify the status of the deleted file item in the Files tab', async () => {
        logInfo('TC-2165', 'Step 5: Verifying missing/faulty indicator for %s', SEEDED_FILE);
        const linkedFileItem = await filesTab.waitForLinkedWorkPackageFileMissing(SEEDED_FILE);
        await expect(linkedFileItem).toBeVisible();
        await expect(linkedFileItem).toContainText(SEEDED_FILE);
        await expect(filesTab.getLinkedWorkPackageFileFaultyAction(SEEDED_FILE)).toBeVisible();
        await expect(filesTab.getLinkedWorkPackageFileMissingTooltip()).toBeVisible();
      });
    }
  );
});
