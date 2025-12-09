import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudActiveAppsPage } from './NextcloudActiveAppsPage';

export class NextcloudAppsDiscoverPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/settings\/apps.*/, { timeout: 10000 });
    await this.getLocator('discoverText').waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickActiveApps(): Promise<NextcloudActiveAppsPage> {
    await this.getLocator('activeAppsLink').waitFor({ state: 'visible', timeout: 10000 });
    await this.getLocator('activeAppsLink').click();
    await this.page.waitForURL(/.*\/settings\/apps\/enabled.*/, { timeout: 10000 });
    await this.page.waitForTimeout(1000);
    return new NextcloudActiveAppsPage(this.page);
  }
}

