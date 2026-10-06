import { test, expect, integrationTags } from '../../base-test';
import {
  OpenProjectLoginPage,
  OpenProjectHomePage,
  OpenProjectWorkPackageFilesTab,
  OpenProjectFilePickerModal,
} from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { ALICE_USER } from '../../../utils/test-users';
import {
  ensureProjectHasNextcloudStorage,
  waitForNextcloudStorageHealthy,
} from '../../../utils/test-helpers';
import { deleteWorkPackageFileLinksByName } from '../../../utils/openproject-api';
import { seedAmpfFolderWithFile } from '../../../utils/nextcloud-api';
import { logInfo } from '../../../utils/logger';
import {
  ampProjectFolder,
  ensureAliceAdminForCurrentSession,
  ensureAliceIsDemoProjectMember,
} from '../shared';

const WORK_PACKAGE_ID = 2;
const AMPERSAND_FOLDER = 'R&D';
const SEEDED_FILE = 'report.md';

test.describe('Work Package Integration - File Picker Navigation', integrationTags, () => {
  test.describe.configure({ timeout: 180_000 });

  test.afterAll(async () => {
    await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, SEEDED_FILE);
  });

  test(
    'OpenProject user can Navigate into a Nextcloud folder with & in the name from OpenProject file picker',
    squashTestCase(2159, { stepCount: 6 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);

      await test.step('Log in to OpenProject as a user connected to Nextcloud', async () => {
        logInfo('TC-2159', 'Step 1: Logging in as Alice via Keycloak SSO');
        await loginPage.navigateTo();
        const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
        await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
        await homePage.waitForReady();
      });

      // SSO users exist in OpenProject only after first browser login.
      // Admin elevation is required only if Demo project storage is not linked yet.
      await ensureAliceIsDemoProjectMember();
      await ensureAliceAdminForCurrentSession(page, homePage);
      // Admin reload skips onboarding dismiss; clear enjoyhint before storage UI clicks.
      await homePage.waitForReady();
      await ensureProjectHasNextcloudStorage('demo-project', page);
      await waitForNextcloudStorageHealthy('demo-project');
      await deleteWorkPackageFileLinksByName(WORK_PACKAGE_ID, SEEDED_FILE);

      await test.step('Open a work package in the project', async () => {
        logInfo('TC-2159', 'Step 2: Navigating to WP #%s', WORK_PACKAGE_ID);
        await filesTab.navigateToDemoProjectWorkPackage(WORK_PACKAGE_ID);
        await filesTab.waitForDemoProjectWorkPackageUrl();
      });

      await test.step('Go to the Files tab', async () => {
        logInfo('TC-2159', 'Step 3: Opening Files tab');
        await filesTab.openWorkPackageFilesTab();
        await filesTab.waitForNextcloudFilesSectionConnected(WORK_PACKAGE_ID);
      });

      // Seed after Files-tab connect so AMPF user ACLs / groupfolders mounts have settled.
      await seedAmpfFolderWithFile({
        projectFolder: ampProjectFolder,
        folderName: AMPERSAND_FOLDER,
        fileName: SEEDED_FILE,
        user: ALICE_USER,
      });

      await test.step(
        'Click Add attachment by clicking or drag and drop in Nextcloud section',
        async () => {
          logInfo('TC-2159', 'Step 4: Opening Nextcloud link-existing file picker');
          await filePicker.openLinkExistingFilesPicker();
          await filePicker.waitForLinkPickerReady();
          await expect(filePicker.getLocator('filesPickerModal')).toBeVisible();
        }
      );

      await test.step('Navigate to the folder named with an & symbol in it', async () => {
        logInfo('TC-2159', 'Step 5: Navigating into %s folder', AMPERSAND_FOLDER);
        await filePicker.navigateIntoFolder(AMPERSAND_FOLDER);
        await expect(
          filePicker.getLocator('filesPickerBreadcrumb').filter({ hasText: AMPERSAND_FOLDER }).first()
        ).toBeVisible();
        await expect(
          filePicker.getLocator('filesPickerListItem').filter({ hasText: SEEDED_FILE }).first()
        ).toBeVisible();
      });

      await test.step('Choose a file inside the folder and add it', async () => {
        logInfo('TC-2159', 'Step 6: Selecting %s and creating file link', SEEDED_FILE);
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
