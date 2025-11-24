import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudDashboardPage } from './NextcloudDashboardPage';

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

  async login(username: string = 'admin', password: string = 'admin'): Promise<NextcloudDashboardPage> {
    await this.navigateTo();
    await this.waitForReady();
    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.clickLogin();
    await this.page.waitForURL(/.*\/apps\/dashboard.*/, { timeout: 10000 });
    return new NextcloudDashboardPage(this.page);
  }
}

