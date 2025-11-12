import { test, expect } from '@playwright/test';
import { OpenProjectPage } from '../../pageobjects/OpenProjectPage';
import { NextcloudPage } from '../../pageobjects/NextcloudPage';
import { KeycloakPage } from '../../pageobjects/KeycloakPage';
import { testConfig } from '../../utils/config';

test.describe('SSO External (Keycloak) Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify we're testing the correct setup method
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

  test('should login to Keycloak', async ({ page }) => {
    const keycloakPage = new KeycloakPage(page);

    await keycloakPage.login();
    const isLoggedIn = await keycloakPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });

  test('should login to Nextcloud with external SSO', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);

    await nextcloudPage.login();
    const isLoggedIn = await nextcloudPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });

  test('should access OpenProject via external SSO', async ({ page }) => {
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

    // External SSO flow would typically involve Keycloak
    // Verify the integration is configured
    await expect(page).toHaveURL(/.*integration_openproject.*/, { timeout: 10000 });
  });

  test('should verify Keycloak realm configuration', async ({ page }) => {
    const keycloakPage = new KeycloakPage(page);

    await keycloakPage.login();
    await keycloakPage.navigateToRealm('opnc');
    
    // Verify realm is accessible
    const isLoggedIn = await keycloakPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
  });
});

