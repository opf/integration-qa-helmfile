import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';

export class NextcloudIntegrationAppPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    const url = `${this.baseUrl}/index.php/apps/integration_openproject`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*integration_openproject.*/, { timeout: 10000 });
  }

  async isVisible(): Promise<boolean> {
    try {
      const currentUrl = this.page.url();
      if (currentUrl.includes('integration_openproject')) {
        return true;
      }
      const title = this.getLocator('integrationAppTitleAlt').first();
      if (await title.isVisible({ timeout: 3000 }).catch(() => false)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

