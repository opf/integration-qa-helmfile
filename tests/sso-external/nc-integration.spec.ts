import { test, expect } from '@playwright/test';
import { NextcloudLoginPage, NextcloudActiveAppsPage, NextcloudOpenIDConnectPage } from '../../pageobjects/nextcloud';
import { testConfig } from '../../utils/config';

test.describe('SSO External - Nextcloud Integration', () => {
  test.beforeEach(async ({ page }) => {
    if (testConfig.setupMethod !== 'sso-external') {
      test.skip();
    }

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        console.log(`[PAGE NAVIGATION] Frame navigated to: ${frame.url()}`);
      }
    });

    page.on('request', (request) => {
      console.log(`[NETWORK REQUEST] ${request.method()} ${request.url()}`);
    });

    page.on('response', (response) => {
      console.log(`[NETWORK RESPONSE] ${response.status()} ${response.url()}`);
    });

    page.on('console', (msg) => {
      console.log(`[PAGE CONSOLE] ${msg.type()}: ${msg.text()}`);
    });
  });

  test('should login to Nextcloud and verify Keycloak provider details', async ({ page }) => {
    const loginPage = new NextcloudLoginPage(page);
    const dashboardPage = await loginPage.login('admin', 'admin');
    await dashboardPage.waitForReady();
    const isLoggedIn = await dashboardPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
    
    const openIdConnectPage = new NextcloudOpenIDConnectPage(page);
    await openIdConnectPage.navigateTo();
    await openIdConnectPage.waitForReady();
    const areProviderDetailsPresent = await openIdConnectPage.verifyKeycloakProviderDetails();
    expect(areProviderDetailsPresent).toBe(true);
  });

  test('should login to Nextcloud and verify OpenProject Integration app', async ({ page }) => {
    const loginPage = new NextcloudLoginPage(page);
    const dashboardPage = await loginPage.login('admin', 'admin');
    await dashboardPage.waitForReady();
    const isLoggedIn = await dashboardPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
    
    const activeAppsPage = new NextcloudActiveAppsPage(page);
    await activeAppsPage.navigateTo();
    await activeAppsPage.waitForReady();
    await activeAppsPage.findOpenProjectIntegrationApp();
    const appVersion = await activeAppsPage.getOpenProjectIntegrationAppVersion();
    const originalTitle = test.info().title;
    test.info().title = `${originalTitle} (v${appVersion})`;    
    test.info().annotations.push({
      type: 'app_version',
      description: `OpenProject Integration App Version: ${appVersion}`
    });

    console.log(`[TEST RESULT] OpenProject Integration App Version: ${appVersion}`);
    const appLink = activeAppsPage.getOpenProjectIntegrationAppLink();
    await expect(appLink).toBeVisible();
    expect(appVersion).toBeTruthy();
    expect(appVersion.length).toBeGreaterThan(0);
    console.log(`[TEST RESULT] Verified App Version: ${appVersion}`);
    const isDisableButtonPresent = await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration();
    expect(isDisableButtonPresent).toBe(true);
    console.log(`[TEST RESULT] Disable Button Present: ${isDisableButtonPresent}`);
  });
});
