import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudDashboardPage } from './NextcloudDashboardPage';
import { NC_ADMIN_USER } from '../../utils/test-users';
import { logDebug } from '../../utils/logger';

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
}

