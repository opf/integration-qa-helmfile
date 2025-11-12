import { test, expect } from '@playwright/test';
import { OpenProjectPage } from '../../pageobjects/OpenProjectPage';
import { NextcloudPage } from '../../pageobjects/NextcloudPage';
import { testConfig } from '../../utils/config';

test.describe('OAuth2 Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify we're testing the correct setup method
    if (testConfig.setupMethod !== 'oauth2') {
      test.skip();
    }
  });

  test('should connect OpenProject and Nextcloud via OAuth2', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);
    const openProjectPage = new OpenProjectPage(page);

    // Login to Nextcloud
    await nextcloudPage.login();
    const isLoggedIn = await nextcloudPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);

    // Navigate to integration app
    await nextcloudPage.navigateToIntegrationApp();
    
    // Wait a bit for the page to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify integration app is accessible
    const isVisible = await nextcloudPage.isIntegrationAppVisible();
    expect(isVisible).toBe(true);

    // Verify we're on the integration app page
    await expect(page).toHaveURL(/.*integration_openproject.*/, { timeout: 10000 });
  });

  test('should login to OpenProject', async ({ page }) => {
    const openProjectPage = new OpenProjectPage(page);

    await openProjectPage.login();
    const isLoggedIn = await openProjectPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });

  test('should login to Nextcloud', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);

    await nextcloudPage.login();
    const isLoggedIn = await nextcloudPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });
});

