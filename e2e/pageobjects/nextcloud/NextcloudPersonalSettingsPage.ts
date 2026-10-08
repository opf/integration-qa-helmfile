import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';

/** Page object for Nextcloud Personal Settings → OpenProject section. Stub for TC 2162 (disconnect flow). */
export class NextcloudPersonalSettingsPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    const url = `${this.baseUrl}/index.php/settings/user/openproject`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/settings\/user\/openproject.*/, { timeout: 10000 });
  }

  async disconnectOpenProject(): Promise<void> {
    throw new Error('Not implemented: waiting for TC 2162 locator discovery');
  }
}
