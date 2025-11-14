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
  //Keycloak verification tests
  test('should login to Keycloak and check op and nc client are present', async ({ page }) => {
    const keycloakPage = new KeycloakPage(page);
    await keycloakPage.login();
    const isLoggedIn = await keycloakPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
    await keycloakPage.clickManageRealms();
    await keycloakPage.selectRealm('opnc');
    const isRealmSelected = await keycloakPage.verifyCurrentRealm('opnc');
    expect(isRealmSelected).toBe(true);
    await keycloakPage.clickClients();
    const areClientsPresent = await keycloakPage.verifyClientsPresent();
    expect(areClientsPresent).toBe(true);
  });

  //Nextcloud integration tests
  test('should login to Nextcloud with external SSO', async ({ page }) => {
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

  test('Access OpenProject via external SSO', async ({ page }) => {
    const nextcloudPage = new NextcloudPage(page);
    const openProjectPage = new OpenProjectPage(page);
    await nextcloudPage.login();
    const isLoggedIn = await nextcloudPage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
    await nextcloudPage.navigateToIntegrationApp();
    const isVisible = await nextcloudPage.isIntegrationAppVisible();
    expect(isVisible).toBe(true);
    await expect(page).toHaveURL(/.*integration_openproject.*/, { timeout: 10000 });
  });
});

