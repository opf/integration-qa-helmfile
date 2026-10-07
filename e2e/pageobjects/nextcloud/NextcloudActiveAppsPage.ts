import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { getErrorMessage } from '../../utils/error-utils';
import { logDebug, logInfo, logWarn } from '../../utils/logger';

export class NextcloudActiveAppsPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    const url = new URL('index.php/settings/apps/enabled', this.baseUrl).toString();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async navigateToDisabledApps(): Promise<void> {
    const url = new URL('index.php/settings/apps/disabled', this.baseUrl).toString();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*(index\.php\/)?settings\/apps\/enabled.*/, { timeout: 20000 });
    const dismissedWizard = await this.dismissFirstRunWizardIfPresent(2000);
    if (dismissedWizard) {
      await this.navigateTo();
      await this.page.waitForURL(/.*(index\.php\/)?settings\/apps\/enabled.*/, { timeout: 20000 });
    }

    const activeAppsHeading = this.getLocator('activeAppsText').first();
    const activeAppsHeadingVisible = await activeAppsHeading
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!activeAppsHeadingVisible) {
      const settingsShell = this.getLocator('appsSettingsContent');
      await settingsShell.first().waitFor({ state: 'visible', timeout: 20000 });
    }
  }

  async waitForDisabledAppsReady(): Promise<void> {
    await this.page.waitForURL(/.*(index\.php\/)?settings\/apps\/disabled.*/, { timeout: 20000 });
    const dismissedWizard = await this.dismissFirstRunWizardIfPresent(2000);
    if (dismissedWizard) {
      await this.navigateToDisabledApps();
      await this.page.waitForURL(/.*(index\.php\/)?settings\/apps\/disabled.*/, { timeout: 20000 });
    }

    const disabledAppsHeading = this.getLocator('disabledAppsText').first();
    const headingVisible = await disabledAppsHeading
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!headingVisible) {
      const settingsShell = this.getLocator('appsSettingsContent');
      await settingsShell.first().waitFor({ state: 'visible', timeout: 20000 });
    }
  }

  async searchApps(query: string): Promise<void> {
    const search = this.getLocator('appsSearchInput').first();
    const visible = await search
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!visible) {
      logDebug('[Nextcloud Apps] Search box not visible; relying on scroll find');
      return;
    }
    await search.fill(query);
    await this.page.waitForTimeout(1000);
  }

  async findOpenProjectIntegrationApp(): Promise<void> {
    await this.searchApps('OpenProject');
    const appRow = this.getLocator('openProjectIntegrationAppRow');

    try {
      await appRow.waitFor({ state: 'visible', timeout: 5000 });
      return;
    } catch {
      const appLink = this.getLocator('openProjectIntegrationAppLink');

      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        try {
          const isVisible = await appLink.isVisible({ timeout: 1000 }).catch(() => false);
          if (isVisible) {
            await appLink.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(500);
            return;
          }
        } catch {
          // keep scrolling
        }

        await this.page.evaluate(() => {
          window.scrollBy(0, 300);
        });
        await this.page.waitForTimeout(500);
        attempts++;
      }

      await appRow.waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  async getOpenProjectIntegrationAppVersion(): Promise<string> {
    await this.findOpenProjectIntegrationApp();
    const versionLocator = this.getLocator('openProjectIntegrationAppVersion');
    await versionLocator.waitFor({ state: 'visible', timeout: 10000 });
    const version = await versionLocator.textContent();
    return version?.trim() || '';
  }

  async isDisableButtonPresentForOpenProjectIntegration(): Promise<boolean> {
    try {
      await this.findOpenProjectIntegrationApp();
      const disableButton = this.getLocator('openProjectIntegrationDisableButton');
      return await disableButton.isVisible({ timeout: 5000 }).catch(() => false);
    } catch {
      return false;
    }
  }

  async isEnableButtonPresentForOpenProjectIntegration(): Promise<boolean> {
    try {
      await this.findOpenProjectIntegrationApp();
      const enableButton = this.getLocator('openProjectIntegrationEnableButton');
      return await enableButton.isVisible({ timeout: 5000 }).catch(() => false);
    } catch {
      return false;
    }
  }

  async clickDisableOpenProjectIntegration(): Promise<void> {
    await this.findOpenProjectIntegrationApp();
    const disableButton = this.getLocator('openProjectIntegrationDisableButton');
    await disableButton.waitFor({ state: 'visible', timeout: 10000 });
    logInfo('[Nextcloud Apps] Disabling OpenProject Integration');
    await Promise.all([
      this.page
        .waitForResponse(
          (response) =>
            response.url().includes('/apps/appstore/api/v1/apps/disable') &&
            response.request().method() === 'POST',
          { timeout: 20000 },
        )
        .catch(() => undefined),
      disableButton.click(),
    ]);
    await this.getLocator('openProjectIntegrationAppRow')
      .waitFor({ state: 'hidden', timeout: 20000 })
      .catch(() => {
        logDebug('[Nextcloud Apps] App row still visible after Disable; continuing');
      });
  }

  /**
   * Enable requires Nextcloud password re-authentication dialog.
   */
  async clickEnableOpenProjectIntegration(adminPassword: string): Promise<void> {
    await this.findOpenProjectIntegrationApp();
    const enableButton = this.getLocator('openProjectIntegrationEnableButton');
    await enableButton.waitFor({ state: 'visible', timeout: 10000 });
    logInfo('[Nextcloud Apps] Enabling OpenProject Integration');
    await enableButton.click();
    await this.confirmPasswordDialog(adminPassword);

    await Promise.race([
      this.page.waitForResponse(
        (response) =>
          response.url().includes('/apps/appstore/api/v1/apps/enable') &&
          response.request().method() === 'POST' &&
          response.ok(),
        { timeout: 20000 },
      ),
      this.getLocator('openProjectIntegrationAppRow').waitFor({
        state: 'hidden',
        timeout: 20000,
      }),
    ]).catch(() => {
      logDebug('[Nextcloud Apps] Enable response/row hide wait timed out; continuing');
    });
  }

  private async confirmPasswordDialog(password: string): Promise<void> {
    const dialog = this.getLocator('passwordConfirmDialog').first();
    const dialogVisible = await dialog
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!dialogVisible) {
      logDebug('[Nextcloud Apps] Password confirm dialog not shown');
      return;
    }

    logInfo('[Nextcloud Apps] Confirming password for app enable');
    await this.getLocator('passwordConfirmInput').fill(password);
    await this.getLocator('passwordConfirmButton').click();
    await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {
      logDebug('[Nextcloud Apps] Password dialog still visible after Confirm');
    });
  }

  /**
   * Idempotent: ensure the OpenProject Integration app is enabled (Active apps + Disable button).
   */
  async ensureOpenProjectIntegrationEnabled(adminPassword: string): Promise<void> {
    try {
      await this.navigateTo();
      await this.waitForReady();

      if (await this.isDisableButtonPresentForOpenProjectIntegration()) {
        logDebug('[Nextcloud Apps] OpenProject Integration already enabled');
        return;
      }

      logWarn('[Nextcloud Apps] OpenProject Integration not on Active apps; enabling from Disabled');
      await this.navigateToDisabledApps();
      await this.waitForDisabledAppsReady();
      await this.clickEnableOpenProjectIntegration(adminPassword);
      await this.navigateTo();
      await this.waitForReady();

      const enabled = await this.isDisableButtonPresentForOpenProjectIntegration();
      if (!enabled) {
        throw new Error(
          'OpenProject Integration is not enabled after ensureOpenProjectIntegrationEnabled()',
        );
      }
    } catch (error: unknown) {
      logWarn(
        '[Nextcloud Apps] ensureOpenProjectIntegrationEnabled failed:',
        getErrorMessage(error),
      );
      throw error;
    }
  }

  getOpenProjectIntegrationAppLink() {
    return this.getLocator('openProjectIntegrationAppLink');
  }
}
