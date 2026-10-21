import { Page, expect } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { logInfo } from '../../utils/logger';

/** Nextcloud Talk — used to smoke-check OpenProject smart picker availability. */
export class NextcloudTalkPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    await this.page.goto(`${this.baseUrl}/index.php/apps/spreed/`, {
      waitUntil: 'domcontentloaded',
    });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/apps\/spreed.*/, { timeout: 20000 });
    const nav = this.getLocator('talkAppNavigation').first();
    // App chrome or conversation list is enough to prove Talk loaded.
    const list = this.getLocator('talkConversationListItem').first();
    const chat = this.getLocator('talkChatInput').first();
    await Promise.race([
      list.waitFor({ state: 'visible', timeout: 20000 }),
      chat.waitFor({ state: 'visible', timeout: 20000 }),
      nav.waitFor({ state: 'visible', timeout: 20000 }),
    ]);
  }

  async openFirstConversationOrStay(): Promise<void> {
    const item = this.getLocator('talkConversationListItem').first();
    if (await item.isVisible({ timeout: 5000 }).catch(() => false)) {
      await item.click();
    }
  }

  async triggerSmartPickerInChat(): Promise<void> {
    const input = this.getLocator('talkChatInput').first();
    await input.waitFor({ state: 'visible', timeout: 20000 });
    await input.click();
    await this.page.keyboard.type('/');
    await this.getLocator('smartPickerOpenProjectProvider')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  }

  async verifyOpenProjectProviderVisible(): Promise<void> {
    await expect(this.getLocator('smartPickerOpenProjectProvider').first()).toBeVisible({
      timeout: 15000,
    });
    logInfo('Talk smart picker lists OpenProject provider');
  }
}
