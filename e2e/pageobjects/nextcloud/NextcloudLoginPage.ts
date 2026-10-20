import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudDashboardPage } from './NextcloudDashboardPage';
import { KeycloakLoginPage } from '../keycloak/KeycloakLoginPage';
import { NC_ADMIN_USER } from '../../utils/test-users';
import { testConfig } from '../../utils/config';
import { logDebug } from '../../utils/logger';
import { resolveHosts } from '../../utils/env-hosts';
import { escapeForRegex, resolveHostname } from '../../utils/url-helpers';

const keycloakHost =
  resolveHostname(process.env.KEYCLOAK_URL) ||
  resolveHostname(process.env.KEYCLOAK_HOST) ||
  resolveHostname(testConfig.keycloak.host) ||
  'keycloak.test';
const keycloakHostPattern = new RegExp(`.*${escapeForRegex(keycloakHost)}.*`);

function usesNextcloudKeycloakLogin(username: string): boolean {
  // SSO stacks: Alice/Brian (and any non-admin) authenticate via OIDC; admin keeps local password.
  return testConfig.setupMethod !== 'oauth2' && username !== NC_ADMIN_USER.username;
}

export class NextcloudLoginPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.getLocator('loginText').waitFor({ state: 'visible', timeout: 10000 });
  }

  async fillUsername(username: string): Promise<void> {
    await this.getLocator('usernameInput').fill(username);
  }

  async fillPassword(password: string): Promise<void> {
    await this.getLocator('passwordInput').fill(password);
  }

  async clickLogin(): Promise<void> {
    // NC can leave a long-lived navigation pending after submit; do not wait on it here.
    await this.getLocator('loginButton').click({ noWaitAfter: true });
  }

  /**
   * Click "Login with keycloak" on the NC login form (mirrors OpenProjectLoginPage).
   */
  async clickKeycloakAuthButton(): Promise<KeycloakLoginPage> {
    if (keycloakHostPattern.test(this.page.url())) {
      const keycloakPage = new KeycloakLoginPage(this.page);
      await keycloakPage.waitForReady().catch(() => {});
      return keycloakPage;
    }

    const primary = this.getLocator('keycloakLoginLink').first();
    const fallbackLocator = this.page
      .locator(
        "a:has-text('Login with keycloak'), a[href*='/apps/user_oidc/login'], a[href*='user_oidc'][href*='keycloak']",
      )
      .first();

    const candidate = await Promise.race([
      primary.waitFor({ state: 'attached', timeout: 10000 }).then(() => primary).catch(() => null),
      fallbackLocator
        .waitFor({ state: 'attached', timeout: 10000 })
        .then(() => fallbackLocator)
        .catch(() => null),
    ]);

    if (candidate) {
      const href = await candidate.getAttribute('href');
      if (href) {
        await this.page.goto(new URL(href, this.page.url()).toString());
      } else {
        await candidate.click({ timeout: 5000 });
      }
    } else {
      const origin = this.resolveNavigationUrl().replace(/\/$/, '');
      await this.page.goto(`${origin}/apps/user_oidc/login/keycloak`);
    }

    await this.page.waitForURL(keycloakHostPattern, { timeout: 15000 });
    const keycloakPage = new KeycloakLoginPage(this.page);
    await keycloakPage.waitForReady().catch(() => {});
    return keycloakPage;
  }

  /**
   * Log in to Nextcloud via Keycloak OIDC (SSO users on sso-external stacks).
   */
  async loginViaKeycloak(
    username: string,
    password: string,
    options?: { redirectPath?: string },
  ): Promise<NextcloudDashboardPage> {
    const redirectPath = options?.redirectPath?.trim();
    const origin = this.resolveNavigationUrl().replace(/\/$/, '');

    if (redirectPath) {
      const path = redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`;
      await this.page.goto(
        `${origin}/login?redirect_url=${encodeURIComponent(path)}`,
        { waitUntil: 'domcontentloaded' },
      );
    } else {
      await this.navigateTo();
    }
    await this.waitForReady();

    const keycloak = await this.clickKeycloakAuthButton();
    await keycloak.loginAsUser(username, password);

    if (redirectPath) {
      const path = redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`;
      await this.page.waitForURL(
        (url) => {
          const href = typeof url === 'string' ? url : url.href;
          return href.includes(path.split('?')[0]) || /\/apps\//.test(href);
        },
        { timeout: 30000, waitUntil: 'domcontentloaded' },
      );
      await this.dismissFirstRunWizardIfPresent(3000).catch(() => false);
      return new NextcloudDashboardPage(this.page);
    }

    const dashboard = new NextcloudDashboardPage(this.page);
    await dashboard.waitForReady();
    await dashboard.closeWelcomeMessage();
    return dashboard;
  }

  /**
   * Log in to Nextcloud.
   * Optional `redirectPath` (e.g. `/index.php/settings/user/openproject`) skips the
   * dashboard settle when the next step is a specific app page.
   * On sso-external, non-admin users go through Keycloak (local NC password is invalid).
   */
  async login(
    username: string = NC_ADMIN_USER.username,
    password: string = NC_ADMIN_USER.password,
    options?: { redirectPath?: string },
  ): Promise<NextcloudDashboardPage> {
    if (usesNextcloudKeycloakLogin(username)) {
      logDebug('Nextcloud login via Keycloak for %s', username);
      return this.loginViaKeycloak(username, password, options);
    }

    const redirectPath = options?.redirectPath?.trim();
    if (redirectPath) {
      const origin = this.resolveNavigationUrl().replace(/\/$/, '');
      const path = redirectPath.startsWith('/') ? redirectPath : `/${redirectPath}`;
      await this.page.goto(
        `${origin}/login?redirect_url=${encodeURIComponent(path)}`,
        { waitUntil: 'domcontentloaded' },
      );
      await this.waitForReady();
      await this.fillUsername(username);
      await this.fillPassword(password);
      await this.clickLogin();
      await this.page.waitForURL(
        (url) => {
          const href = typeof url === 'string' ? url : url.href;
          return href.includes(path.split('?')[0]) || /\/apps\//.test(href);
        },
        { timeout: 30000, waitUntil: 'domcontentloaded' },
      );
      await this.dismissFirstRunWizardIfPresent(3000).catch(() => false);
      return new NextcloudDashboardPage(this.page);
    }

    await this.navigateTo();
    await this.waitForReady();
    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.clickLogin();
    // NC 34 may land on /apps/dashboard or stay on / with the Dashboard shell.
    const dashboard = new NextcloudDashboardPage(this.page);
    await dashboard.waitForReady();
    await dashboard.closeWelcomeMessage();
    return dashboard;
  }

  /**
   * Storage OAuth interstitial ("Please log in before granting…") → click Log in.
   * No-op when the username form is already shown or consent is next.
   */
  async clickOAuthConnectLoginIfPrompted(timeoutMs = 8000): Promise<boolean> {
    const connectLogin = this.getLocator('oauthConnectLoginButton').first();
    const usernameInput = this.getLocator('usernameInput').first();
    if (await usernameInput.isVisible().catch(() => false)) {
      return false;
    }
    const visible = await connectLogin
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    if (!visible) {
      return false;
    }
    await connectLogin.click();
    return true;
  }

  /**
   * If the Nextcloud login form is visible (e.g. during OAuth redirect), sign in.
   * Does not require landing on the dashboard — OAuth may continue elsewhere.
   * On sso-external, non-admin users use Keycloak instead of the local password form.
   */
  async loginIfPrompted(username: string, password: string, timeoutMs = 8000): Promise<boolean> {
    const usernameInput = this.getLocator('usernameInput').first();
    const keycloakLink = this.getLocator('keycloakLoginLink').first();
    const visible = await Promise.race([
      usernameInput.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true),
      keycloakLink.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true),
    ]).catch(() => false);
    if (!visible) {
      logDebug('Nextcloud login form not prompted');
      return false;
    }

    if (usesNextcloudKeycloakLogin(username)) {
      logDebug('Nextcloud OAuth login via Keycloak for %s', username);
      const keycloak = await this.clickKeycloakAuthButton();
      await keycloak.loginAsUser(username, password);
      return true;
    }

    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.clickLogin();
    return true;
  }

  /**
   * On the Nextcloud OAuth consent screen (storage login), click Grant access / Authorize / Allow.
   * No-op when already past the consent screen.
   */
  async grantAccessIfPrompted(timeoutMs = 15000): Promise<boolean> {
    const grant = this.getLocator('oauthGrantAccessButton').first();
    const authorize = this.getLocator('oauthAuthorizeButton').first();
    const allow = this.getLocator('oauthAllowButton').first();
    const ncHost =
      resolveHostname(resolveHosts().nextcloud) || resolveHosts().nextcloud;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      // Left Nextcloud (e.g. redirected to OpenProject authorize) — stop polling.
      if (!this.page.url().includes(ncHost)) {
        return false;
      }
      for (const candidate of [grant, authorize, allow]) {
        if (await candidate.isVisible().catch(() => false)) {
          await candidate.click();
          return true;
        }
      }
      await this.page.waitForTimeout(500);
    }
    return false;
  }
}
