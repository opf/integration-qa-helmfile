import { test, expect } from '@playwright/test';
import { KeycloakLoginPage, KeycloakHomePage } from '../../pageobjects/keycloak';
import { testConfig } from '../../utils/config';

test.describe('SSO External - Keycloak Integration', () => {
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

  test('should login to Keycloak and check op and nc client are present', async ({ page }) => {
    const loginPage = new KeycloakLoginPage(page);
    await loginPage.login();
    const homePage = new KeycloakHomePage(page);
    await homePage.waitForReady();
    const isLoggedIn = await homePage.isLoggedIn();
    expect(isLoggedIn).toBe(true);
    const realmsPage = await homePage.clickManageRealms();
    await realmsPage.waitForReady();
    await realmsPage.ensureRealmSelected('opnc');
    const isRealmSelected = await realmsPage.verifyCurrentRealm('opnc');
    expect(isRealmSelected).toBe(true);
    const clientsPage = await realmsPage.clickClients();
    await clientsPage.waitForReady();
    const areClientsPresent = await clientsPage.verifyClientsPresent();
    if (!areClientsPresent) {
      await page.screenshot({ path: 'test-results/clients-not-found.png', fullPage: true });
    }
    expect(areClientsPresent).toBe(true);
  });
});
