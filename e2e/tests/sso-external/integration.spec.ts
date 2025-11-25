import { test, expect } from '@playwright/test';
import { OpenProjectLoginPage, OpenProjectHomePage } from '../../pageobjects/openproject';
import { testConfig } from '../../utils/config';
import { ALICE_USER, ADMIN_USER } from '../../utils/test-users';

test.describe('SSO External - OpenProject Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify wetupMethod
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


  test.skip('Add Nextcloud file storage to Demo project', async ({ page }) => {
    const loginPage = new OpenProjectLoginPage(page);
    const homePage = await loginPage.login(ADMIN_USER.username, ADMIN_USER.password);
    await homePage.waitForReady();
    const allProjectsButton = homePage.getLocator('allProjectsButton');
    await allProjectsButton.waitFor({ state: 'visible', timeout: 10000 });
    await allProjectsButton.click();
    const demoProjectItem = homePage.getLocator('demoProjectItem').filter({ hasText: 'Demo project' });
    await demoProjectItem.waitFor({ state: 'visible', timeout: 10000 });
    await demoProjectItem.click();
    await homePage.waitForDemoProjectUrl();
    expect(page.url()).toContain('/projects/demo-project');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const projectSettingsMenuItem = homePage.getLocator('projectSettingsMenuItem').first();
    await projectSettingsMenuItem.waitFor({ state: 'visible', timeout: 15000 });
    await projectSettingsMenuItem.click();
    await homePage.waitForDemoProjectSettingsGeneralUrl();
    expect(page.url()).toContain('/projects/demo-project/settings/general');
    const filesMenuItem = homePage.getLocator('filesMenuItem');
    await filesMenuItem.waitFor({ state: 'visible', timeout: 10000 });
    await filesMenuItem.click();
    await homePage.waitForDemoProjectStoragesExternalUrl();
    expect(page.url()).toContain('/projects/demo-project/settings/project_storages/external_file_storages');
    const externalFileStoragesText = homePage.getLocator('externalFileStoragesText');
    await externalFileStoragesText.waitFor({ state: 'visible', timeout: 10000 });
    await expect(externalFileStoragesText).toBeVisible();
    const newStorageLink = homePage.getLocator('newStorageLink');
    await newStorageLink.waitFor({ state: 'visible', timeout: 10000 });
    await newStorageLink.click();
    await homePage.waitForDemoProjectStoragesNewUrl();
    expect(page.url()).toContain('/projects/demo-project/settings/project_storages/new');
    const addFileStorageHeading = homePage.getLocator('addFileStorageHeading').first();
    await addFileStorageHeading.waitFor({ state: 'visible', timeout: 10000 });
    await expect(addFileStorageHeading).toBeVisible();
    const storageDropdown = homePage.getLocator('storageDropdown');
    await storageDropdown.waitFor({ state: 'visible', timeout: 10000 });
    await storageDropdown.selectOption('1');
    const continueButton = homePage.getLocator('continueButton');
    await continueButton.waitFor({ state: 'visible', timeout: 10000 });
    await continueButton.click();
    const automaticFolderModeRadio = homePage.getLocator('automaticFolderModeRadio');
    await automaticFolderModeRadio.waitFor({ state: 'visible', timeout: 10000 });
    const isChecked = await automaticFolderModeRadio.isChecked();
    if (!isChecked) {
      await automaticFolderModeRadio.check();
    }
    expect(await automaticFolderModeRadio.isChecked()).toBe(true);
    const addButton = homePage.getLocator('addButton');
    await addButton.waitFor({ state: 'visible', timeout: 10000 });
    await addButton.click();
    const loginToNextcloudRequiredHeading = homePage.getLocator('loginToNextcloudRequiredHeading');
    await loginToNextcloudRequiredHeading.waitFor({ state: 'visible', timeout: 10000 });
    await expect(loginToNextcloudRequiredHeading).toBeVisible();
    const nextcloudLoginButton = homePage.getLocator('nextcloudLoginButton');
    await nextcloudLoginButton.waitFor({ state: 'visible', timeout: 10000 });
    await expect(nextcloudLoginButton).toBeVisible();
    const popupPromise = page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await nextcloudLoginButton.click();
    const popup = await popupPromise;
    if (popup) {
      await page.waitForTimeout(1000);
      await popup.close().catch(() => {});
    }
    await page.waitForTimeout(1000);
    await homePage.navigateToDemoProjectStoragesExternal();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    expect(page.url()).toContain('/projects/demo-project/settings/project_storages/external_file_storages');
  });

  test.skip('Enable Nextcloud file Storage AMPF for a project', async ({ page }) => {
    const loginPage = new OpenProjectLoginPage(page);
    await loginPage.navigateTo();
    const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
    await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

    const homePage = new OpenProjectHomePage(page);
    await homePage.waitForReady();

    await homePage.navigateToAdminStoragesSettings();
    await homePage.waitForAdminStoragesSettingsUrl();

    const nextcloudStorageLink = homePage.getLocator('adminStoragesNextcloudLink').first();
    await nextcloudStorageLink.waitFor({ state: 'visible', timeout: 10000 });
    await nextcloudStorageLink.click();
    await page.waitForURL(/\/admin\/settings\/storages\/1\/edit\/?$/, { timeout: 15000 });

    const projectsTab = homePage.getLocator('adminStoragesProjectsTab').first();
    await projectsTab.waitFor({ state: 'visible', timeout: 10000 });
    await projectsTab.click();
    await homePage.waitForAdminStorageProjectsUrl();

    const addProjectsButton = homePage.getLocator('adminStoragesAddProjectsButton').first();
    await addProjectsButton.waitFor({ state: 'visible', timeout: 10000 });
    await addProjectsButton.click();
    await homePage.waitForAdminStorageProjectsNewUrl();
  });
});

