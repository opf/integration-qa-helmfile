import { test, expect } from '@playwright/test';
import { NextcloudLoginPage } from '../../pageobjects/nextcloud';
import { testConfig } from '../../utils/config';

test.describe('SSO Nextcloud Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify we're testing the correct setup method
    if (testConfig.setupMethod !== 'sso-nextcloud') {
      test.skip();
    }
  });

  test('should login to Nextcloud with SSO', async ({ page }) => {
    const loginPage = new NextcloudLoginPage(page);
    const dashboardPage = await loginPage.login();
    await dashboardPage.waitForReady();
    const isLoggedIn = await dashboardPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });

  test('should access OpenProject via SSO from Nextcloud', async ({ page }) => {
    const loginPage = new NextcloudLoginPage(page);

    const dashboardPage = await loginPage.login();
    await dashboardPage.waitForReady();
    const isLoggedIn = await dashboardPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);

    const integrationAppPage = await dashboardPage.navigateToIntegrationApp();
    await integrationAppPage.waitForReady();
    
    const isVisible = await integrationAppPage.isVisible();
    expect(isVisible).toBe(true);

    await expect(page).toHaveURL(/.*integration_openproject.*/, { timeout: 10000 });
  });

  test('should verify SSO configuration', async ({ page }) => {
    const loginPage = new NextcloudLoginPage(page);

    const dashboardPage = await loginPage.login();
    await dashboardPage.waitForReady();
    const integrationAppPage = await dashboardPage.navigateToIntegrationApp();
    await integrationAppPage.waitForReady();
    
    const isVisible = await integrationAppPage.isVisible();
    expect(isVisible).toBe(true);
  });
});

