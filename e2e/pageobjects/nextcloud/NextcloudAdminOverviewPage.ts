import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudOpenIDConnectPage } from './NextcloudOpenIDConnectPage';

export class NextcloudAdminOverviewPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/settings\/admin\/overview.*/, { timeout: 10000 });
  }

  async clickOpenIDConnect(): Promise<NextcloudOpenIDConnectPage> {
    await this.getLocator('openIdConnectLink').waitFor({ state: 'visible', timeout: 10000 });
    await this.getLocator('openIdConnectLink').click();
    const oidcPage = new NextcloudOpenIDConnectPage(this.page);
    await oidcPage.waitForReady();
    return oidcPage;
  }
}

