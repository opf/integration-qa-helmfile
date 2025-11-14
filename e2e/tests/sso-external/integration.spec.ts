import { test, expect } from '@playwright/test';
import { OpenProjectPage } from '../../pageobjects/OpenProjectPage';
import { NextcloudPage } from '../../pageobjects/NextcloudPage';
import { KeycloakPage } from '../../pageobjects/KeycloakPage';
import { testConfig } from '../../utils/config';
import { ALICE_USER } from '../../utils/test-users';

test.describe('SSO External - Nextcloud & OpenProject Integration', () => {
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

  //Nextcloud integration tests
  test('should login to Nextcloud and verify Keycloak provider details', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);
    await nextcloudPage.login('admin', 'admin');
    const isLoggedIn = await nextcloudPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
    await nextcloudPage.closeWelcomeMessage();
    await nextcloudPage.clickProfileIcon();
    await nextcloudPage.clickAdministrationSettings();
    await nextcloudPage.clickOpenIDConnect();
    const areProviderDetailsPresent = await nextcloudPage.verifyKeycloakProviderDetails();
    expect(areProviderDetailsPresent).toBe(true);
  });

  test('should login to Nextcloud and verify OpenProject Integration app', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);
    await nextcloudPage.login('admin', 'admin');
    const isLoggedIn = await nextcloudPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
    await nextcloudPage.closeWelcomeMessage();
    await nextcloudPage.clickProfileIcon();
    await nextcloudPage.clickAppsMenu();
    await nextcloudPage.clickActiveApps();
    await nextcloudPage.findOpenProjectIntegrationApp();
    const appVersion = await nextcloudPage.getOpenProjectIntegrationAppVersion();
    const originalTitle = test.info().title;
    test.info().title = `${originalTitle} (v${appVersion})`;    
    test.info().annotations.push({
      type: 'app_version',
      description: `OpenProject Integration App Version: ${appVersion}`
    });

    console.log(`[TEST RESULT] OpenProject Integration App Version: ${appVersion}`);
    const appLink = nextcloudPage.getOpenProjectIntegrationAppLink();
    await expect(appLink).toBeVisible();
    expect(appVersion).toBeTruthy();
    expect(appVersion.length).toBeGreaterThan(0);
    console.log(`[TEST RESULT] Verified App Version: ${appVersion}`);
    const isDisableButtonPresent = await nextcloudPage.isDisableButtonPresentForOpenProjectIntegration();
    expect(isDisableButtonPresent).toBe(true);
    console.log(`[TEST RESULT] Disable Button Present: ${isDisableButtonPresent}`);
  });

  //OpenProject integration tests
  
  test('Access OpenProject via Keycloak user authentication', async ({ page }) => {
    const openProjectPage = new OpenProjectPage(page);
    const keycloakPage = new KeycloakPage(page);
    await openProjectPage.navigateTo();
    await openProjectPage.clickKeycloakAuthButton();
    
    await keycloakPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
    
    await page.waitForURL(/.*openproject\.test.*/, { timeout: 15000 });
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/login');
    expect(currentUrl).toContain('openproject.test');
    
    // Verify user profile button is present in top right corner
    const isProfileButtonPresent = await openProjectPage.verifyUserProfileButton('Alice Hansen');
    expect(isProfileButtonPresent).toBe(true);
    
    // Get and verify the user name from the profile button
    const userName = await openProjectPage.getUserNameFromProfile();
    expect(userName).toContain('Alice Hansen');
    
    console.log(`[TEST RESULT] Successfully logged in as: ${userName}`);
    console.log(`[TEST RESULT] Current URL: ${currentUrl}`);
  });
});

