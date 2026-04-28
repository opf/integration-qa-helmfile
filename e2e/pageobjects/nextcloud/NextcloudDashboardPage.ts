import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudAdminOverviewPage } from './NextcloudAdminOverviewPage';
import { NextcloudAppsDiscoverPage } from './NextcloudAppsDiscoverPage';
import { NextcloudIntegrationAppPage } from './NextcloudIntegrationAppPage';
import { logWarn } from '../../utils/logger';

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
      // Nextcloud first-run wizard modal (NC32/NC33) shows an animation and only then
      // renders the Close button. We make this resilient to timing and to the modal
      // being absent entirely.
      const modal = this.page.locator('#modal-description-nc-vue-2, .modal-container').first();
      const closeButton = modal.locator("button[aria-label='Close']").first();

      const hasModal = await modal.isVisible({ timeout: 2000 }).catch(() => false);
      if (!hasModal) return;

      await closeButton.waitFor({ state: 'visible', timeout: 15000 });
      await closeButton.click({ timeout: 5000 });

      // Wait for the modal to disappear (preferred) and fall back to button state.
      await modal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
        logWarn('Welcome modal did not hide after click; continuing anyway');
      });
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

