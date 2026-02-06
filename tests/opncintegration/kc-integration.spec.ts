import { test, expect, integrationTags } from '../base-test';
import { KeycloakLoginPage, KeycloakHomePage } from '../../pageobjects/keycloak';

test.describe('SSO External - Keycloak Integration', integrationTags, () => {
  test('should login to Keycloak and check op and nc client are present', { tag: ['@smoke'] }, async ({ page }) => {
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
