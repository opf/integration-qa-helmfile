import { Page, expect } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { resolveHosts } from '../../utils/env-hosts';
import { logInfo } from '../../utils/logger';
import { hostUrlPattern } from '../../utils/url-helpers';

/** Nextcloud top header: OpenProject nav link and unified search. */
export class NextcloudHeaderPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  getOpenProjectHeaderLink() {
    return this.getLocator('headerOpenProjectLink').first();
  }

  async openAppsMenuIfNeeded(): Promise<void> {
    if (await this.getOpenProjectHeaderLink().isVisible({ timeout: 1500 }).catch(() => false)) {
      return;
    }
    const menuBtn = this.getLocator('headerAppsMenuButton').first();
    await menuBtn.waitFor({ state: 'visible', timeout: 10000 });
    await menuBtn.click();
    await this.getOpenProjectHeaderLink().waitFor({ state: 'visible', timeout: 10000 });
  }

  async verifyOpenProjectHeaderVisible(timeoutMs = 15000): Promise<void> {
    await this.openAppsMenuIfNeeded();
    await expect(this.getOpenProjectHeaderLink()).toBeVisible({ timeout: timeoutMs });
  }

  async clickOpenProjectHeaderAndAssertRedirect(): Promise<void> {
    await this.openAppsMenuIfNeeded();
    const link = this.getOpenProjectHeaderLink();
    await link.waitFor({ state: 'visible', timeout: 15000 });

    const opHost = resolveHosts().openproject;
    await Promise.all([
      this.page.waitForURL(hostUrlPattern(opHost), { timeout: 30000 }),
      link.click(),
    ]);
    expect(this.page.url()).toContain(opHost);
    logInfo('Header OpenProject link redirected to %s', this.page.url());
  }

  async openUnifiedSearch(): Promise<void> {
    const trigger = this.getLocator('unifiedSearchTrigger').first();
    await trigger.waitFor({ state: 'visible', timeout: 15000 });
    // NC only fires provider searches after /search/providers has returned and Vue wired them.
    const providersReady = this.page.waitForResponse(
      (res) =>
        res.url().includes('/ocs/v2.php/search/providers') &&
        !res.url().includes('/search/providers/') &&
        res.ok(),
      { timeout: 15000 },
    );
    await trigger.click();
    await providersReady;
    const input = this.getLocator('unifiedSearchInput').first();
    await input.waitFor({ state: 'visible', timeout: 15000 });
    // Providers must be wired before typing or the modal sticks on "Searching...".
    await expect(input).toBeEditable({ timeout: 10000 });
  }

  async searchUnified(query: string): Promise<void> {
    const input = this.getLocator('unifiedSearchInput').first();
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.click();
    // Modal may re-render the input after providers load; retry fill until OP search fires.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const fired = this.page
        .waitForRequest(
          (r) =>
            r.url().includes('/search/providers/openproject-search/search') &&
            r.method() === 'GET',
          { timeout: 5000 },
        )
        .then(() => true, () => false);
      await input.fill(query);
      if (await fired) {
        break;
      }
      if (attempt === 3) {
        throw new Error('Unified search never queried openproject-search');
      }
      await input.fill('');
    }
    await this.page.waitForResponse(
      (res) =>
        res.url().includes('/search/providers/openproject-search/search') &&
        res.request().method() === 'GET' &&
        res.ok(),
      { timeout: 30000 },
    );
  }

  async verifyOpenProjectSearchGroupVisible(timeoutMs = 30000): Promise<void> {
    await expect(this.getLocator('unifiedSearchOpenProjectGroup').first()).toBeVisible({
      timeout: timeoutMs,
    });
    await expect(this.getLocator('unifiedSearchResultItem').first()).toBeVisible({
      timeout: timeoutMs,
    });
  }

  async clickFirstOpenProjectSearchResultAndAssertRedirect(): Promise<void> {
    const result = this.getLocator('unifiedSearchResultItem').first();
    await result.waitFor({ state: 'visible', timeout: 15000 });

    const opHost = resolveHosts().openproject;
    await Promise.all([
      this.page.waitForURL(hostUrlPattern(opHost), { timeout: 30000 }),
      result.click(),
    ]);
    expect(this.page.url()).toContain(opHost);
    logInfo('Unified search result redirected to %s', this.page.url());
  }
}
