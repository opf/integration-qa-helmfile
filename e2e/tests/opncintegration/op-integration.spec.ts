import {
  test,
  expect,
  openProjectUrl,
  integrationTags,
} from '../base-test';
import type { Page } from '@playwright/test';
import { OpenProjectLoginPage, OpenProjectHomePage } from '../../pageobjects/openproject';
import { ALICE_USER } from '../../utils/test-users';
import {
  deleteProject,
  deleteUploadedTestFile,
  ensureProjectHasNextcloudStorage,
  ensureUserIsAdmin,
} from '../../utils/test-helpers';
import {
  deleteWorkPackageFileLinksByName,
  setUserAdmin,
} from '../../utils/openproject-api';
import type { EnsureAdminResult } from '../../utils/openproject-api';
import { testConfig } from '../../utils/config';
import { logInfo, logWarn } from '../../utils/logger';

async function ensureAliceAdmin(): Promise<EnsureAdminResult> {
  const identifiers = [
    ALICE_USER.username,
    ALICE_USER.email,
    `${ALICE_USER.username}@example.com`,
  ].filter((identifier, index, all): identifier is string => {
    return Boolean(identifier) && all.indexOf(identifier) === index;
  });

  let lastError: unknown;
  for (const identifier of identifiers) {
    try {
      return await ensureUserIsAdmin(identifier);
    } catch (error: unknown) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('not found via API')) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('OpenProject user for Alice not found via API');
}

async function ensureAliceAdminForCurrentSession(
  page: Page,
  homePage: OpenProjectHomePage
): Promise<void> {
  const { updated } = await ensureAliceAdmin();
  if (!updated) return;

  await page.reload({ waitUntil: 'domcontentloaded' });
  await homePage.waitForReady();
}

test.describe('SSO External - OpenProject Integration', integrationTags, () => {
  test.describe.configure({ mode: 'serial' });
  //OpenProject integration tests
  
  test('Access OpenProject via Keycloak user authentication', async ({ page }) => {
    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
    
    const homePage = new OpenProjectHomePage(page);
    await homePage.waitForOpenProjectUrl();
    await homePage.waitForReady();
    
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/login');
    expect(currentUrl).toContain(testConfig.openproject.host);
    
    const isProfileButtonPresent = await homePage.verifyUserProfileButton('Alice Hansen');
    expect(isProfileButtonPresent).toBe(true);
    const userName = await homePage.getUserNameFromProfile();
    expect(userName).toContain('Alice Hansen');
  });
  
  test('Add Nextcloud file storage to Demo project', async ({ page }) => {
    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

    const homePage = new OpenProjectHomePage(page);
    await homePage.waitForReady();

    await ensureAliceAdminForCurrentSession(page, homePage);

    await ensureProjectHasNextcloudStorage('demo-project', page);

    await homePage.navigateToDemoProjectStoragesExternal();
    await homePage.waitForDemoProjectStoragesExternalUrl();
    await expect(page).toHaveURL(openProjectUrl('/projects/demo-project/settings/project_storages/external_file_storages'));

    const nextcloudStorageRow = homePage.getLocator('nextcloudStorageRow');
    await nextcloudStorageRow.first().waitFor({ state: 'visible', timeout: 15000 });
    await expect(nextcloudStorageRow.first()).toContainText(/Nextcloud/i);
  });

  test('Upload a file from OP to NC using ampf', async ({ page }) => {
    const uploadedFileName = 'op-to-nc-upload-test.md';

    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

    const homePage = new OpenProjectHomePage(page);
    await homePage.waitForReady();

    await ensureAliceAdminForCurrentSession(page, homePage);

    await ensureProjectHasNextcloudStorage('demo-project', page);
    await deleteWorkPackageFileLinksByName(2, uploadedFileName);

    await homePage.navigateToDemoProjectWorkPackageFiles(2);
    await homePage.waitForDemoProjectWorkPackageFilesUrl();

    const uploadInput = homePage.getLocator('workPackageFilesUploadInput');
    await uploadInput.waitFor({ state: 'attached', timeout: 15000 });

    await uploadInput.setInputFiles(`fixtures/${uploadedFileName}`);

    const filesPickerModal = homePage.getLocator('filesPickerModal');
    await filesPickerModal.waitFor({ state: 'visible', timeout: 15000 });

    const chooseLocationButton = homePage.getLocator('filesPickerConfirmButton');
    await chooseLocationButton.waitFor({ state: 'visible', timeout: 15000 });
    await chooseLocationButton.click();

    // Handle "file already exists" modal if it appears
    const existingFileModalTitle = homePage.getLocator('existingFileModalTitle');
    if (await existingFileModalTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
      const replaceButton = homePage.getLocator('fileExistsReplaceButton').first();
      await replaceButton.waitFor({ state: 'visible', timeout: 10000 });
      await replaceButton.click();
    }

    const uploadSuccessMessage = homePage.getLocator('filesUploadSuccessMessage');
    await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
    await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');
  });

  test('OpenProject Files tab lists linked Nextcloud items and available actions', async ({ page }) => {
    const uploadedFileName = 'op-to-nc-upload-test.md';

    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

    const homePage = new OpenProjectHomePage(page);
    await homePage.waitForReady();

    await ensureAliceAdminForCurrentSession(page, homePage);

    await ensureProjectHasNextcloudStorage('demo-project', page);

    await homePage.navigateToDemoProjectWorkPackageFiles(2);
    await homePage.waitForDemoProjectWorkPackageFilesUrl();

    const linkedFileItem = await homePage.hoverLinkedWorkPackageFile(uploadedFileName);
    await expect(linkedFileItem).toContainText(uploadedFileName);

    const downloadAction = homePage.getLinkedWorkPackageFileDownloadAction(uploadedFileName);
    await expect(downloadAction).toBeVisible();
    await expect(downloadAction).toBeEnabled();

    const openLocationAction = homePage.getLinkedWorkPackageFileOpenLocationAction(uploadedFileName);
    await expect(openLocationAction).toBeVisible();
    await expect(openLocationAction).toBeEnabled();

    const removeLinkAction = homePage.getLinkedWorkPackageFileRemoveLinkAction(uploadedFileName);
    await expect(removeLinkAction).toBeVisible();
    await expect(removeLinkAction).toBeEnabled();
  });

  test('Copy ampf Demo project', async ({ page }) => {
    test.setTimeout(120_000);

    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

    const homePage = new OpenProjectHomePage(page);
    await homePage.waitForReady();
    await ensureAliceAdminForCurrentSession(page, homePage);

    await homePage.copyDemoProjectViaUi('test');

    await expect(page).toHaveURL(openProjectUrl('/projects/test'));

    await homePage.navigateToProjectStoragesExternal('test', 30000);

    const nextcloudStorageRow = homePage.getLocator('nextcloudStorageRow');
    await nextcloudStorageRow.first().waitFor({ state: 'visible', timeout: 15000 });
    await expect(nextcloudStorageRow.first()).toContainText(/Nextcloud/i);
  });

  test.afterAll(async () => {
    // Clean up test data created during the test suite
    try {
      const deletedLinks = await deleteWorkPackageFileLinksByName(2, 'op-to-nc-upload-test.md');
      logInfo('[Cleanup] Deleted uploaded test file links:', deletedLinks);
    } catch (err) {
      logWarn('[Cleanup] Failed to delete uploaded test file links:', err);
    }

    try {
      await deleteUploadedTestFile(
        'op-to-nc-upload-test.md',
        'Demo project (1)',
        ALICE_USER
      );
      logInfo('[Cleanup] Deleted uploaded test file from Demo project (1)');
    } catch (err) {
      logWarn('[Cleanup] Failed to delete uploaded test file:', err);
    }

    try {
      const deleted = await deleteProject('test');
      if (deleted) {
        logInfo('[Cleanup] Deleted copied project "test"');
      } else {
        logInfo('[Cleanup] Project "test" not found (already deleted or never created)');
      }
    } catch (err) {
      logWarn('[Cleanup] Failed to delete project "test":', err);
    }

    try {
      const { userId } = await ensureAliceAdmin();
      await setUserAdmin(userId, false);
      logInfo('[Cleanup] Revoked admin permissions from Alice');
    } catch (err) {
      logWarn('[Cleanup] Failed to revoke admin permissions from Alice:', err);
    }
  });

});
