import { test, expect } from '@playwright/test';
import { OpenProjectLoginPage } from '../../pageobjects/openproject';
import { NextcloudLoginPage } from '../../pageobjects/nextcloud';
import { testConfig } from '../../utils/config';

test.describe('OAuth2 Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify we're testing the correct setup method
    if (testConfig.setupMethod !== 'oauth2') {
      test.skip();
    }
  });

  test('should connect OpenProject and Nextcloud via OAuth2', async ({ page }) => {
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

  test('should login to OpenProject', async ({ page }) => {
    const loginPage = new OpenProjectLoginPage(page);

    const homePage = await loginPage.login();
    await homePage.waitForReady();
    const isLoggedIn = await loginPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });

  test('should login to Nextcloud', async ({ page }) => {
    const loginPage = new NextcloudLoginPage(page);

    const dashboardPage = await loginPage.login();
    await dashboardPage.waitForReady();
    const isLoggedIn = await dashboardPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });
});

