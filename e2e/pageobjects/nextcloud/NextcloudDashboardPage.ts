import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudAdminOverviewPage } from './NextcloudAdminOverviewPage';
import { NextcloudAppsDiscoverPage } from './NextcloudAppsDiscoverPage';
import { NextcloudIntegrationAppPage } from './NextcloudIntegrationAppPage';

export class NextcloudDashboardPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/apps\/dashboard.*/, { timeout: 10000 });
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      const loginForm = await this.getLocator('loginForm').count();
      if (loginForm === 0) {
        return true;
      }
      const userMenu = this.getLocator('userMenu').first();
      if (await userMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async closeWelcomeMessage(): Promise<void> {
    try {
      const closeButton = this.getLocator('closeButton').first();
      await closeButton.waitFor({ state: 'visible', timeout: 10000 });
      await closeButton.click();
      await closeButton.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
        console.log('Close button did not hide after click, modal may have closed differently');
      });
      await this.page.waitForTimeout(300);
    } catch {
    }
  }

  async clickProfileIcon(): Promise<void> {
    await this.getLocator('profileIcon').click();
    await this.page.waitForTimeout(500);
  }

  async clickAdministrationSettings(): Promise<NextcloudAdminOverviewPage> {
    await this.getLocator('administrationSettingsLink').click();
    await this.page.waitForURL(/.*\/settings\/admin.*/, { timeout: 10000 });
    return new NextcloudAdminOverviewPage(this.page);
  }

  async clickAppsMenu(): Promise<NextcloudAppsDiscoverPage> {
    await this.getLocator('appsMenu').waitFor({ state: 'visible', timeout: 10000 });
    await this.getLocator('appsMenu').click();
    await this.page.waitForURL(/.*\/settings\/apps.*/, { timeout: 10000 });
    await this.page.waitForTimeout(1000);
    return new NextcloudAppsDiscoverPage(this.page);
  }

  async navigateToIntegrationApp(): Promise<NextcloudIntegrationAppPage> {
    const integrationAppPage = new NextcloudIntegrationAppPage(this.page);
    await integrationAppPage.navigateTo();
    return integrationAppPage;
  }
}

