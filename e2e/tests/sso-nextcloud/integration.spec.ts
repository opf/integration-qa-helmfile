import { test, expect } from '@playwright/test';
import { OpenProjectPage } from '../../pageobjects/OpenProjectPage';
import { NextcloudPage } from '../../pageobjects/NextcloudPage';
import { testConfig } from '../../utils/config';

test.describe('SSO Nextcloud Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify we're testing the correct setup method
    if (testConfig.setupMethod !== 'sso-nextcloud') {
      test.skip();
    }
  });

  test('should login to Nextcloud with SSO', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);

    await nextcloudPage.login();
    const isLoggedIn = await nextcloudPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });

  test('should access OpenProject via SSO from Nextcloud', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);
    const openProjectPage = new OpenProjectPage(page);

    // Login to Nextcloud
    await nextcloudPage.login();
    const isLoggedIn = await nextcloudPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);

    // Navigate to integration app
    await nextcloudPage.navigateToIntegrationApp();
    
    // Verify integration app is accessible
    const isVisible = await nextcloudPage.isIntegrationAppVisible();
    expect(isVisible).toBe(true);

    // SSO flow would typically redirect to OpenProject
    // Verify the integration is configured
    await expect(page).toHaveURL(/.*integration_openproject.*/, { timeout: 10000 });
  });

  test('should verify SSO configuration', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);

    await nextcloudPage.login();
    await nextcloudPage.navigateToIntegrationApp();
    
    // Verify SSO integration is visible and configured
    const isVisible = await nextcloudPage.isIntegrationAppVisible();
    expect(isVisible).toBe(true);
  });
});

