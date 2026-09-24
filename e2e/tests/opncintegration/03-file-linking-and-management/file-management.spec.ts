import { test, expect, integrationTags } from '../../base-test';
import { OpenProjectLoginPage, OpenProjectHomePage, OpenProjectWorkPackageFilesTab, OpenProjectFilePickerModal } from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { ALICE_USER } from '../../../utils/test-users';
import { ensureProjectHasNextcloudStorage, waitForNextcloudStorageHealthy } from '../../../utils/test-helpers';
import { deleteWorkPackageFileLinksByName } from '../../../utils/openproject-api';
import { 
  uploadedFileName, 
  keepBothSiblingPattern, 
  replacedFileBody,
  cleanupCollisionArtifacts,
  ensureAliceIsDemoProjectMember
} from '../shared';

test.describe('Files Tab Management', integrationTags, () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test(
    'Upload a file from OP to NC using ampf',
    squashTestCase(2068, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      await homePage.waitForReady();
      await ensureAliceIsDemoProjectMember();
      await ensureProjectHasNextcloudStorage('demo-project', page);
      await waitForNextcloudStorageHealthy('demo-project');
      await cleanupCollisionArtifacts();
      await deleteWorkPackageFileLinksByName(2, uploadedFileName);

      await test.step('Open target work package Files tab in OpenProject', async () => {
        await filesTab.navigateToDemoProjectWorkPackageFiles(2);
        await filesTab.waitForDemoProjectWorkPackageFilesUrl();
        await filesTab.waitForNextcloudFilesSectionConnected(2);
      });

      await test.step('Click "Upload files" and select a file to upload', async () => {
        await filePicker.openFilesPickerWithUpload(uploadedFileName);
        await filePicker.waitForFilesPickerReady(uploadedFileName);
        await expect(filePicker.getLocator('filesPickerModal')).toBeVisible();
      });

      await test.step('Confirm upload location', async () => {
        await filePicker.confirmFilesPickerOptionalReplace();
      });

      await test.step('Verify the file is uploaded and linked', async () => {
        const uploadSuccessMessage = filePicker.getLocator('filesUploadSuccessMessage');
        await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
        await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');

        const linkedFileItem = filesTab.getLinkedWorkPackageFileItem(uploadedFileName);
        await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(linkedFileItem).toContainText(uploadedFileName);
      });
    }
  );

  test(
    'OpenProject Files tab lists linked Nextcloud items and available actions',
    squashTestCase(2148, { stepCount: 2 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      await homePage.waitForReady();
      const workPackageId = 2;

      await test.step('Navigate to the work package files tab', async () => {
        await filesTab.navigateToDemoProjectWorkPackage(workPackageId);
        await filesTab.waitForDemoProjectWorkPackageUrl();
        await filesTab.openWorkPackageFilesTab();
        await filesTab.waitForNextcloudFilesSectionConnected(workPackageId);
      });

      await test.step('Verify linked Nextcloud files and available actions', async () => {
        const fileItem = filesTab.getLinkedWorkPackageFileItem(uploadedFileName);
        await fileItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(fileItem).toContainText(uploadedFileName);

        await filesTab.hoverLinkedWorkPackageFile(uploadedFileName);
        await expect(filesTab.getLinkedWorkPackageFileDownloadAction(uploadedFileName)).toBeVisible();
        await expect(
          filesTab.getLinkedWorkPackageFileOpenLocationAction(uploadedFileName)
        ).toBeVisible();
        await expect(
          filesTab.getLinkedWorkPackageFileRemoveLinkAction(uploadedFileName)
        ).toBeVisible();
      });
    }
  );

  test(
    'File Upload Name Collision - Replace Existing File',
    squashTestCase(2163, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      await homePage.waitForReady();
      await ensureAliceIsDemoProjectMember();
      await ensureProjectHasNextcloudStorage('demo-project', page);
      await waitForNextcloudStorageHealthy('demo-project');
      await cleanupCollisionArtifacts();
      await filesTab.navigateToDemoProjectWorkPackageFiles(2);
      await filesTab.waitForDemoProjectWorkPackageFilesUrl();
      await filesTab.waitForNextcloudFilesSectionConnected(2);
      await filePicker.seedAmpfUpload(uploadedFileName);

      await test.step('Open target work package Files tab in OpenProject', async () => {
        await filesTab.navigateToDemoProjectWorkPackageFiles(2);
        await filesTab.waitForDemoProjectWorkPackageFilesUrl();
        await filesTab.waitForNextcloudFilesSectionConnected(2);
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
        }
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
        await expect
          .poll(
            async () =>
              (await filesTab.downloadLinkedWorkPackageFileText(uploadedFileName)).includes(
                'collision-replace-marker'
              ),
            { timeout: 20000 }
          )
          .toBe(true);
      });
    }
  );

  test(
    'File Upload Name Collision - Keep Both Files',
    squashTestCase(2164, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      await homePage.waitForReady();
      await ensureAliceIsDemoProjectMember();
      await ensureProjectHasNextcloudStorage('demo-project', page);
      await waitForNextcloudStorageHealthy('demo-project');
      await cleanupCollisionArtifacts();
      await filesTab.navigateToDemoProjectWorkPackageFiles(2);
      await filesTab.waitForDemoProjectWorkPackageFilesUrl();
      await filesTab.waitForNextcloudFilesSectionConnected(2);
      await filePicker.seedAmpfUpload(uploadedFileName);

      await test.step('Open target work package Files tab in OpenProject', async () => {
        await filesTab.navigateToDemoProjectWorkPackageFiles(2);
        await filesTab.waitForDemoProjectWorkPackageFilesUrl();
        await filesTab.waitForNextcloudFilesSectionConnected(2);
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
        }
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
    }
  );

  test.afterAll(async () => {
    await cleanupCollisionArtifacts();
  });
});
