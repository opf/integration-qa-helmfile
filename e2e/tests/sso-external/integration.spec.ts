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
});

