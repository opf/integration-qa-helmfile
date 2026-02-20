import {
  test,
  expect,
  openProjectUrl,
  integrationTags,
} from '../base-test';
import { OpenProjectLoginPage, OpenProjectHomePage } from '../../pageobjects/openproject';
import { ALICE_USER } from '../../utils/test-users';
import {
  deleteProject,
  deleteUploadedTestFile,
  ensureProjectHasNextcloudStorage,
  ensureUserIsAdmin,
} from '../../utils/test-helpers';
import { setUserAdmin } from '../../utils/openproject-api';
import { testConfig } from '../../utils/config';
import { logInfo, logWarn } from '../../utils/logger';

test.describe('SSO External - OpenProject Integration', integrationTags, () => {
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
    const loginIdentifier = ALICE_USER.email ?? `${ALICE_USER.username}@example.com`;
    await ensureUserIsAdmin(loginIdentifier);

    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

    const homePage = new OpenProjectHomePage(page);
    await homePage.waitForReady();

    await ensureProjectHasNextcloudStorage('demo-project', page);

    await homePage.navigateToDemoProjectStoragesExternal();
    await homePage.waitForDemoProjectStoragesExternalUrl();
    await expect(page).toHaveURL(openProjectUrl('/projects/demo-project/settings/project_storages/external_file_storages'));

    const nextcloudStorageRow = homePage.getLocator('nextcloudStorageRow');
    await nextcloudStorageRow.first().waitFor({ state: 'visible', timeout: 15000 });
    await expect(nextcloudStorageRow.first()).toContainText(/Nextcloud/i);
  });

  test('Upload a file from OP to NC using ampf', async ({ page }) => {
    const loginIdentifier = ALICE_USER.email ?? `${ALICE_USER.username}@example.com`;
    await ensureUserIsAdmin(loginIdentifier);
    const uploadedFileName = 'op-to-nc-upload-test.md';

    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

    const homePage = new OpenProjectHomePage(page);
    await homePage.waitForReady();

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

  test('Copy ampf Demo project', async ({ page }) => {
    const loginIdentifier = ALICE_USER.email ?? `${ALICE_USER.username}@example.com`;
    await ensureUserIsAdmin(loginIdentifier);

    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

    const homePage = new OpenProjectHomePage(page);
    await homePage.copyDemoProjectViaUi('test');

    await expect(page).toHaveURL(openProjectUrl('/projects/test'));

    await homePage.navigateToProjectStoragesExternal('test');

    const nextcloudStorageRow = homePage.getLocator('nextcloudStorageRow');
    await nextcloudStorageRow.first().waitFor({ state: 'visible', timeout: 15000 });
    await expect(nextcloudStorageRow.first()).toContainText(/Nextcloud/i);
  });

  test.afterAll(async () => {
    // Clean up test data created during the test suite
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
      const loginIdentifier = ALICE_USER.email ?? `${ALICE_USER.username}@example.com`;
      const { userId } = await ensureUserIsAdmin(loginIdentifier);
      await setUserAdmin(userId, false);
      logInfo('[Cleanup] Revoked admin permissions from Alice');
    } catch (err) {
      logWarn('[Cleanup] Failed to revoke admin permissions from Alice:', err);
    }
  });

});

