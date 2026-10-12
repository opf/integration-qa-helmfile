import { test, expect, dualSetupTags, skipUnlessSetupMethod, isSetupMethod } from '../../base-test';
import {
  OpenProjectWorkPackageFilesTab,
  OpenProjectFilePickerModal,
} from '../../../pageobjects/openproject';
import { deleteWorkPackageFileLinksByName } from '../../../utils/openproject-api';
import { seedAmpfFolderWithFile } from '../../../utils/nextcloud-api';
import { logInfo } from '../../../utils/logger';
import {
  ampProjectFolder,
  dualSetupSquashCase,
  ensureFilesTabNextcloudConnected,
  integrationBrowserUser,
  isOauth2Setup,
  prepareIntegrationUserForDemoStorage,
} from '../shared';

const WORK_PACKAGE_ID = 2;
const AMPERSAND_FOLDER = 'R&D';
const SEEDED_FILE = 'report.md';

const SSO_TITLE =
  'OpenProject user can Navigate into a Nextcloud folder with & in the name from OpenProject file picker';

const squash = dualSetupSquashCase(
  { id: 2159, title: SSO_TITLE },
  { id: 2234, title: `[oauth2] ${SSO_TITLE}` },
  6,
);

test.describe('Work Package Integration - File Picker Navigation', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, SEEDED_FILE);
  });

  test(
    squash.title,
    squash.details,
    async ({ page }) => {
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      const user = integrationBrowserUser();

      await test.step('Log in to OpenProject as a user connected to Nextcloud', async () => {
        logInfo(
          'File-picker nav',
          'Step 1: Logging in as %s (%s)',
          user.username,
          isOauth2Setup() ? 'local oauth2' : 'Keycloak SSO',
        );
        const { homePage } = await prepareIntegrationUserForDemoStorage(page);
        await homePage.waitForReady();
      });

      await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, SEEDED_FILE);

      await test.step('Open a work package in the project', async () => {
        logInfo('File-picker nav', 'Step 2: Navigating to WP #%s', WORK_PACKAGE_ID);
        await filesTab.navigateToDemoProjectWorkPackage(WORK_PACKAGE_ID);
        await filesTab.waitForDemoProjectWorkPackageUrl();
      });

      await test.step('Go to the Files tab', async () => {
        logInfo('File-picker nav', 'Step 3: Opening Files tab');
        await filesTab.openWorkPackageFilesTab();
        await ensureFilesTabNextcloudConnected(page, filesTab, WORK_PACKAGE_ID, user);
      });

      // Seed after Files-tab connect so AMPF user ACLs / groupfolders mounts have settled.
      await seedAmpfFolderWithFile({
        projectFolder: ampProjectFolder,
        folderName: AMPERSAND_FOLDER,
        fileName: SEEDED_FILE,
        user,
      });

      await test.step(
        'Click Add attachment by clicking or drag and drop in Nextcloud section',
        async () => {
          logInfo('File-picker nav', 'Step 4: Opening Nextcloud link-existing file picker');
          await filePicker.openLinkExistingFilesPicker();
          await filePicker.waitForLinkPickerReady();
          await expect(filePicker.getLocator('filesPickerModal')).toBeVisible();
        }
      );

      await test.step('Navigate to the folder named with an & symbol in it', async () => {
        logInfo('File-picker nav', 'Step 5: Navigating into %s folder', AMPERSAND_FOLDER);
        // oauth2 PullPreview may lack AMPF projectFolder registration — open via home mount.
        await filePicker.ensureAtAmpfProjectFolder(ampProjectFolder);
        await filePicker.navigateIntoFolder(AMPERSAND_FOLDER);
        await expect(
          filePicker.getLocator('filesPickerBreadcrumb').filter({ hasText: AMPERSAND_FOLDER }).first()
        ).toBeVisible();
        await expect(
          filePicker.getLocator('filesPickerListItem').filter({ hasText: SEEDED_FILE }).first()
        ).toBeVisible();
      });

      await test.step('Choose a file inside the folder and add it', async () => {
        logInfo('File-picker nav', 'Step 6: Selecting %s and creating file link', SEEDED_FILE);
        await filePicker.selectFileInPicker(SEEDED_FILE);
        await filePicker.confirmLinkSelection();

        const uploadSuccessMessage = filePicker.getLocator('filesUploadSuccessMessage');
        await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
        await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');

        const linkedFileItem = filesTab.getLinkedWorkPackageFileItem(SEEDED_FILE);
        await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(linkedFileItem).toContainText(SEEDED_FILE);
      });
    }
  );
});
