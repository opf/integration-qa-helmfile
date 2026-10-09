import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudDashboardPage } from './NextcloudDashboardPage';
import { NC_ADMIN_USER } from '../../utils/test-users';
import { logDebug } from '../../utils/logger';
import { resolveHosts } from '../../utils/env-hosts';
import { resolveHostname } from '../../utils/url-helpers';

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
    await this.getLocator('loginButton').click();
  }

  async login(username: string = NC_ADMIN_USER.username, password: string = NC_ADMIN_USER.password): Promise<NextcloudDashboardPage> {
    await this.navigateTo();
    await this.waitForReady();
    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.clickLogin();
    await this.page.waitForURL(/.*\/apps\/dashboard.*/, { timeout: 10000 });
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
   */
  async loginIfPrompted(username: string, password: string, timeoutMs = 8000): Promise<boolean> {
    const usernameInput = this.getLocator('usernameInput').first();
    const visible = await usernameInput
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    if (!visible) {
      logDebug('Nextcloud login form not prompted');
      return false;
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

