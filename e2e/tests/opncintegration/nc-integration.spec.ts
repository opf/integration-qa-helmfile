import { test, expect, integrationTags } from '../base-test';
import { NextcloudLoginPage, NextcloudActiveAppsPage, NextcloudOpenIDConnectPage } from '../../pageobjects/nextcloud';
import { logInfo } from '../../utils/logger';

test.describe('SSO External - Nextcloud Integration', integrationTags, () => {
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

    logInfo('[TEST RESULT] OpenProject Integration App Version: %s', appVersion);
    const appLink = activeAppsPage.getOpenProjectIntegrationAppLink();
    await expect(appLink).toBeVisible();
    expect(appVersion).toBeTruthy();
    expect(appVersion.length).toBeGreaterThan(0);
    logInfo('[TEST RESULT] Verified App Version: %s', appVersion);
    const isDisableButtonPresent = await activeAppsPage.isDisableButtonPresentForOpenProjectIntegration();
    expect(isDisableButtonPresent).toBe(true);
    logInfo('[TEST RESULT] Disable Button Present: %s', isDisableButtonPresent);
  });
});
