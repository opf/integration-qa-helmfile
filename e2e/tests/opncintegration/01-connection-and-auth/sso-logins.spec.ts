
import { test, expect, integrationTags } from '../../base-test';
import { testConfig } from '../../../utils/config';
import { KeycloakLoginPage, KeycloakHomePage } from '../../../pageobjects/keycloak';
import { NextcloudLoginPage, NextcloudOpenIDConnectPage } from '../../../pageobjects/nextcloud';
import { OpenProjectLoginPage, OpenProjectHomePage } from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { NC_ADMIN_USER, ALICE_USER } from '../../../utils/test-users';

test.describe('SSO External - Auth and Logins', integrationTags, () => {
  test(
    'should login to Keycloak and check op and nc client are present',
    squashTestCase(2187, { tag: ['@smoke'] }),
    async ({ page }) => {
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
    },
  );
  
  test(
    'should login to Nextcloud and verify Keycloak provider details',
    squashTestCase(2166, { stepCount: 3 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      let openIdConnectPage: NextcloudOpenIDConnectPage;

      await test.step(
        'Open Nextcloud login page (/login) and log in as administrator (admin / admin)',
        async () => {
          const dashboardPage = await loginPage.login(
            NC_ADMIN_USER.username,
            NC_ADMIN_USER.password,
          );
          await dashboardPage.waitForReady();
          expect(await dashboardPage.isLoggedIn()).toBe(true);
        },
      );

      await test.step(
        'Navigate to the OpenID Connect admin settings page (/settings/admin/user_oidc)',
        async () => {
          openIdConnectPage = new NextcloudOpenIDConnectPage(page);
          await openIdConnectPage.navigateTo();
          await openIdConnectPage.waitForReady();
        },
      );

      await test.step(
        'Locate the Keycloak provider section (h3 title "Keycloak") and verify provider details',
        async () => {
          const areProviderDetailsPresent =
            await openIdConnectPage.verifyKeycloakProviderDetails();
          expect(areProviderDetailsPresent).toBe(true);
        },
      );
    },
  );
  
  test(
    'Access OpenProject via Keycloak user authentication',
    squashTestCase(2160, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      let keycloakLoginPage: Awaited<ReturnType<OpenProjectLoginPage['clickKeycloakAuthButton']>>;

      await test.step('Navigate to the OpenProject login page', async () => {
        await loginPage.navigateTo();
      });

      await test.step('Click the Keycloak authentication button', async () => {
        keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      });

      await test.step('Log in as test user', async () => {
        await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      });

      await test.step('Verify the user session on the OpenProject home page', async () => {
        const homePage = new OpenProjectHomePage(page);
        await homePage.waitForOpenProjectUrl();
        await homePage.waitForReady();

        const currentUrl = page.url();
        expect(currentUrl).not.toContain('/login');
        expect(currentUrl).toContain(testConfig.openproject.host);

        const isProfileButtonPresent = await homePage.verifyUserProfileButton('Alice Hansen');
        expect(isProfileButtonPresent).toBe(true);
        const userName = await homePage.getUserNameFromProfile();
        expect(userName).toContain('Alice Hansen');
      });
    }
  );
});
