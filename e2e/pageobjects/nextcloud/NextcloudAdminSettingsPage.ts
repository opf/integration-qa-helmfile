import { Page, expect } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { testConfig } from '../../utils/config';
import { resolveHosts } from '../../utils/env-hosts';
import { logInfo } from '../../utils/logger';
import { escapeForRegex } from '../../utils/url-helpers';

/** Nextcloud Administration → OpenProject integration settings. */
export class NextcloudAdminSettingsPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    await this.page.goto(`${this.baseUrl}/index.php/settings/admin/openproject`, {
      waitUntil: 'domcontentloaded',
    });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/settings\/admin\/openproject.*/, { timeout: 20000 });
    await this.getLocator('ncAdminSettingsOpenProjectSection')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
  }

  async verifyHostConfigured(): Promise<void> {
    const section = this.getLocator('ncAdminSettingsServerHostSection').first();
    await section.waitFor({ state: 'visible', timeout: 15000 });

    const expectedHost = resolveHosts().openproject || testConfig.openproject.host;
    const hostValue = this.getLocator('ncAdminSettingsHostValue').first();
    const hostInput = this.getLocator('ncAdminSettingsHostInput').first();

    if (await hostValue.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(hostValue).toContainText(expectedHost, { timeout: 10000 });
    } else {
      await expect(hostInput).toHaveValue(new RegExp(escapeForRegex(expectedHost)), {
        timeout: 10000,
      });
    }

    const badge = this.getLocator('ncAdminSettingsHostCompleteBadge').first();
    await expect(badge).toBeVisible({ timeout: 10000 });
    logInfo('NC admin settings: OpenProject host configured (%s)', expectedHost);
  }

  async verifyAuthMethodConfigured(): Promise<string> {
    const section = this.getLocator('ncAdminSettingsAuthMethodSection').first();
    await section.waitFor({ state: 'visible', timeout: 15000 });

    const badge = this.getLocator('ncAdminSettingsAuthMethodCompleteBadge').first();
    await expect(badge).toBeVisible({ timeout: 10000 });

    const label = this.getLocator('ncAdminSettingsAuthMethodLabel').first();
    let methodText = '';
    if (await label.isVisible({ timeout: 3000 }).catch(() => false)) {
      methodText = (await label.innerText()).trim();
    } else {
      methodText = (await section.innerText()).trim();
    }

    const setup = testConfig.setupMethod;
    if (setup === 'oauth2') {
      expect(methodText.toLowerCase()).toMatch(/oauth/);
    } else {
      expect(methodText.toLowerCase()).toMatch(/openid|oidc|sso|single-sign-on/);
    }
    logInfo('NC admin settings: auth method verified (%s)', methodText.slice(0, 80));
    return methodText;
  }

  async verifyProjectFoldersConfigured(): Promise<void> {
    // AMPF section sits below OAuth forms — scroll into view first.
    const heading = this.getLocator('ncAdminSettingsProjectFolderHeading').first();
    const status = this.getLocator('ncAdminSettingsProjectFolderStatus').first();
    const section = this.getLocator('ncAdminSettingsProjectFolderSection').first();

    for (const loc of [heading, status, section]) {
      if (await loc.count()) {
        await loc.scrollIntoViewIfNeeded().catch(() => undefined);
      }
    }

    await expect(heading.or(status).or(section).first()).toBeVisible({ timeout: 15000 });
    const body = this.getLocator('ncAdminSettingsOpenProjectSection').first();
    const text = (await body.innerText()).toLowerCase();
    expect(text).toMatch(/automatically managed folders|project folder|group folder/);
    logInfo('NC admin settings: project folders / AMPF section visible');
  }
}
