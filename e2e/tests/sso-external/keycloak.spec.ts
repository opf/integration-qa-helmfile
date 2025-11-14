import { test, expect } from '@playwright/test';
import { KeycloakPage } from '../../pageobjects/KeycloakPage';
import { testConfig } from '../../utils/config';

test.describe('SSO External - Keycloak Configuration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify setupMethod
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
});

