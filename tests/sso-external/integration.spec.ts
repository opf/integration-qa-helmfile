import { test, expect } from '@playwright/test';
import { OpenProjectLoginPage, OpenProjectHomePage } from '../../pageobjects/openproject';
import { testConfig } from '../../utils/config';
import { ALICE_USER } from '../../utils/test-users';
import { ensureUserIsAdmin, setUserAdmin } from '../../utils/openproject-api';

test.describe('SSO External - OpenProject Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify setupMethod
    if (testConfig.setupMethod !== 'sso-external') {
      test.skip();
    }

    // Track all page navigations
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        console.log(`[PAGE NAVIGATION] Frame navigated to: ${frame.url()}`);
      }
    });

    // Track all network requests
    page.on('request', (request) => {
      console.log(`[NETWORK REQUEST] ${request.method()} ${request.url()}`);
    });

    // Track all network responses
    page.on('response', (response) => {
      console.log(`[NETWORK RESPONSE] ${response.status()} ${response.url()}`);
    });

    // Track console messages from the page
    page.on('console', (msg) => {
      console.log(`[PAGE CONSOLE] ${msg.type()}: ${msg.text()}`);
    });
  });

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
    expect(currentUrl).toContain('openproject.test');
    
    const isProfileButtonPresent = await homePage.verifyUserProfileButton('Alice Hansen');
    expect(isProfileButtonPresent).toBe(true);
    const userName = await homePage.getUserNameFromProfile();
    expect(userName).toContain('Alice Hansen');
  });
  
  test('Add Nextcloud file storage to Demo project', async ({ page }) => {
    const loginIdentifier = ALICE_USER.email ?? `${ALICE_USER.username}@example.com`;
    const { userId, updated } = await ensureUserIsAdmin(loginIdentifier);
    let shouldRevokeAdmin = updated;
    let homePage: OpenProjectHomePage | null = null;

    try {
      const loginPage = new OpenProjectLoginPage(page);
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

      homePage = new OpenProjectHomePage(page);
      await homePage.waitForReady();
      await homePage.navigateToDemoProjectStoragesExternal();
      await homePage.waitForDemoProjectStoragesExternalUrl();

      const nextcloudStorageRow = homePage.getLocator('nextcloudStorageRow');
      const existingStorageCount = await nextcloudStorageRow.count();
      if (existingStorageCount > 0) {
        await expect(nextcloudStorageRow.first()).toContainText(/Nextcloud/i);
        console.log('[INFO] Nextcloud storage already exists for Demo project. Skipping creation.');
        return;
      }

      const newStorageLink = homePage.getLocator('newStorageLink');
      await newStorageLink.waitFor({ state: 'visible', timeout: 10000 });
      await newStorageLink.click();
      await homePage.waitForDemoProjectStoragesNewUrl();

      const addFileStorageHeading = homePage.getLocator('addFileStorageHeading').first();
      await addFileStorageHeading.waitFor({ state: 'visible', timeout: 10000 });
      await expect(addFileStorageHeading).toBeVisible();

      const storageDropdown = homePage.getLocator('storageDropdown');
      await storageDropdown.waitFor({ state: 'visible', timeout: 10000 });
      const selectedOption = storageDropdown.locator('option:checked');
      let selectedText = (await selectedOption.textContent())?.toLowerCase() ?? '';
      if (!selectedText.includes('nextcloud')) {
        const nextcloudOption = storageDropdown.locator('option', { hasText: /nextcloud/i }).first();
        if (await nextcloudOption.count() === 0) {
          throw new Error('Nextcloud option is not available in the storage dropdown.');
        }
        const nextcloudValue = await nextcloudOption.getAttribute('value');
        if (!nextcloudValue) {
          throw new Error('Nextcloud option is missing a value attribute.');
        }
        await storageDropdown.selectOption(nextcloudValue);
      }
      await expect(storageDropdown.locator('option:checked')).toContainText(/nextcloud/i);

      const continueButton = homePage.getLocator('continueButton');
      await continueButton.waitFor({ state: 'visible', timeout: 10000 });
      await continueButton.click();

      const automaticFolderModeRadio = homePage.getLocator('automaticFolderModeRadio');
      await automaticFolderModeRadio.waitFor({ state: 'visible', timeout: 10000 });
      if (!(await automaticFolderModeRadio.isChecked())) {
        await automaticFolderModeRadio.check();
      }
      await expect(automaticFolderModeRadio).toBeChecked();

      const addButton = homePage.getLocator('addButton');
      await addButton.waitFor({ state: 'visible', timeout: 10000 });
      await addButton.click();

      const successMessage = homePage.getLocator('storageCreationSuccessMessage');
      await successMessage.waitFor({ state: 'visible', timeout: 10000 });
      await expect(successMessage).toContainText('Successful creation.');

      const loginToNextcloudRequiredHeading = homePage.getLocator('loginToNextcloudRequiredHeading');
      await loginToNextcloudRequiredHeading.waitFor({ state: 'visible', timeout: 10000 });
      await expect(loginToNextcloudRequiredHeading).toBeVisible();

      const nextcloudLoginButton = homePage.getLocator('nextcloudLoginButton');
      await nextcloudLoginButton.waitFor({ state: 'visible', timeout: 10000 });
      const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
      await nextcloudLoginButton.click();
      const popup = await popupPromise;
      if (popup) {
        await page.waitForTimeout(1000);
        await popup.close().catch(() => {});
      }

      await homePage.navigateToDemoProjectStoragesExternal();
      await homePage.waitForDemoProjectStoragesExternalUrl();
      expect(page.url()).toContain('/projects/demo-project/settings/project_storages/external_file_storages');
    } finally {
      if (shouldRevokeAdmin) {
        await setUserAdmin(userId, false);
      }
    }
  });

  test('Upload a file from OP to NC using ampf', async ({ page }) => {
    const loginIdentifier = ALICE_USER.email ?? `${ALICE_USER.username}@example.com`;
    const { userId, updated } = await ensureUserIsAdmin(loginIdentifier);
    let shouldRevokeAdmin = updated;
    const uploadedFileName = 'op-to-nc-upload-test.md';

    try {
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
      const existingFileModalTitle = page
        .locator('.spot-modal--header-title', { hasText: 'This file already exists' });
      if (await existingFileModalTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
        const replaceButton = page
          .locator('.spot-modal .spot-action-bar--right .button.-primary', { hasText: 'Replace' })
          .first();
        await replaceButton.waitFor({ state: 'visible', timeout: 10000 });
        await replaceButton.click();
      }

      const uploadSuccessMessage = homePage.getLocator('filesUploadSuccessMessage');
      await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
      await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');

      // Wait for the file list to be updated with the new (or replaced) file
      // await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // const fileLinkLabel = homePage
      //   .getLocator('workPackageFileLink')
      //   .filter({ hasText: uploadedFileName })
      //   .first();
      // await fileLinkLabel.waitFor({ state: 'visible', timeout: 15000 });

      // const fileLink = fileLinkLabel.locator('xpath=ancestor::a[1]');

      // const [nextcloudPage] = await Promise.all([
      //   page.context().waitForEvent('page'),
      //   fileLink.click(),
      // ]);

      // await nextcloudPage.waitForLoadState('domcontentloaded');

      // const loginWithKeycloakButton = nextcloudPage
      //   .getByRole('link', { name: /Login with keycloak/i });
      // if (await loginWithKeycloakButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      //   await Promise.all([
      //     nextcloudPage.waitForLoadState('networkidle'),
      //     loginWithKeycloakButton.click(),
      //   ]);
      // }

      // if (nextcloudPage.url().includes('keycloak.test')) {
      //   const keycloakUsernameInput = nextcloudPage.locator('input[name=\"username\"], #username');
      //   const keycloakPasswordInput = nextcloudPage.locator('input[name=\"password\"], #password');
      //   const keycloakLoginButton = nextcloudPage.getByRole('button', { name: /Log in|Sign in/i });

      //   await keycloakUsernameInput.waitFor({ state: 'visible', timeout: 10000 });
      //   await keycloakUsernameInput.fill(ALICE_USER.username);
      //   await keycloakPasswordInput.fill(ALICE_USER.password);

      //   await Promise.all([
      //     nextcloudPage.waitForLoadState('networkidle'),
      //     keycloakLoginButton.click(),
      //   ]);
      // }

      // const viewsApiUrlPrefix = `https://${testConfig.nextcloud.host}/apps/files/api/v1/views`;
      // await nextcloudPage.waitForResponse(
      //   (response) =>
      //     response.url().startsWith(viewsApiUrlPrefix) &&
      //     response.request().method() === 'GET' &&
      //     response.status() === 200,
      //   { timeout: 20000 },
      // );

      // const actionsMenuButton = nextcloudPage.locator(
      //   'button.button-vue--icon-only.action-item__menutoggle',
      // );
      // await actionsMenuButton.waitFor({ state: 'visible', timeout: 15000 });
      // await actionsMenuButton.click();

      // const encodedFileName = encodeURIComponent(uploadedFileName);
      // const deleteRequest = nextcloudPage.waitForResponse((response) => {
      //   return (
      //     response.request().method() === 'DELETE' &&
      //     response.url().includes('/remote.php/dav/files/') &&
      //     response.url().includes(encodedFileName)
      //   );
      // });

      // const deleteButton = nextcloudPage.getByRole('menuitem', { name: /Delete/i });
      // await deleteButton.waitFor({ state: 'visible', timeout: 15000 });

      // const deleteResponse = await Promise.all([
      //   deleteRequest,
      //   deleteButton.click(),
      // ]).then(([response]) => response);

      // expect(deleteResponse.status()).toBe(204);
    } finally {
      if (shouldRevokeAdmin) {
        await setUserAdmin(userId, false);
      }
    }
  });
});

