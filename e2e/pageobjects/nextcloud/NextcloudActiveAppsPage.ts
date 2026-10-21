import { expect, Locator, Page } from '@playwright/test';
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

  async navigateToIntegrationsApps(): Promise<void> {
    // Nextcloud category slug is singular: /settings/apps/integration
    const url = new URL('index.php/settings/apps/integration', this.baseUrl).toString();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*(index\.php\/)?settings\/apps\/enabled.*/, { timeout: 20000 });
    const dismissedWizard = await this.dismissFirstRunWizardIfPresent(2000);
    if (dismissedWizard) {
      await this.navigateTo();
      await this.page.waitForURL(/.*(index\.php\/)?settings\/apps\/enabled.*/, { timeout: 20000 });
    }

    await this.waitForAppsSettingsShell();
  }

  /** NC34+ App store may use #app-content-vue; heading alone can race Vue hydration. */
  private async waitForAppsSettingsShell(timeoutMs = 20000): Promise<void> {
    const heading = this.getLocator('activeAppsText').first();
    const shell = this.getLocator('appsSettingsContent').first();
    const search = this.getLocator('appsSearchInput').first();
    await Promise.race([
      heading.waitFor({ state: 'visible', timeout: timeoutMs }),
      shell.waitFor({ state: 'visible', timeout: timeoutMs }),
      search.waitFor({ state: 'visible', timeout: timeoutMs }),
    ]);
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

  async waitForIntegrationsAppsReady(): Promise<void> {
    await this.page.waitForURL(
      /.*(index\.php\/)?settings\/apps\/integration(?:\?|$|\/)/,
      { timeout: 20000 },
    );
    const dismissedWizard = await this.dismissFirstRunWizardIfPresent(2000);
    if (dismissedWizard) {
      await this.navigateToIntegrationsApps();
      await this.page.waitForURL(
        /.*(index\.php\/)?settings\/apps\/integration(?:\?|$|\/)/,
        { timeout: 20000 },
      );
    }

    const integrationsHeading = this.getLocator('integrationsAppsText').first();
    const headingVisible = await integrationsHeading
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
    await expect(search).toHaveValue(query, { timeout: 5000 });
  }

  async findOpenProjectIntegrationApp(): Promise<void> {
    await this.searchApps('OpenProject');
    const appRow = this.getLocator('openProjectIntegrationAppRow');

    try {
      await appRow.waitFor({ state: 'visible', timeout: 5000 });
      return;
    } catch {
      const appLink = this.getLocator('openProjectIntegrationAppLink');

      await expect
        .poll(
          async () => {
            const isVisible = await appLink.isVisible().catch(() => false);
            if (isVisible) {
              await appLink.scrollIntoViewIfNeeded();
              return true;
            }
            await this.page.evaluate(() => {
              window.scrollBy(0, 300);
            });
            return false;
          },
          { timeout: 10000, intervals: [500] },
        )
        .toBe(true)
        .catch(async () => {
          await appRow.waitFor({ state: 'visible', timeout: 5000 });
        });
    }
  }

  async getOpenProjectIntegrationAppVersion(): Promise<string> {
    await this.findOpenProjectIntegrationApp();
    const versionLocator = this.getLocator('openProjectIntegrationAppVersion');
    await versionLocator.waitFor({ state: 'visible', timeout: 10000 });
    const version = await versionLocator.textContent();
    return version?.trim() || '';
  }

  /**
   * When an update is available, Nextcloud replaces primary Disable/Enable with
   * "Update to …"; the action moves under the Actions menu.
   */
  private async isRowActionAvailable(buttonKey: string, menuItemKey: string): Promise<boolean> {
    try {
      await this.findOpenProjectIntegrationApp();
      const primary = this.getLocator(buttonKey);
      // Playwright isVisible({ timeout }) does not wait for attachment; use waitFor.
      if (await primary.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) {
        return true;
      }

      const actionsButton = this.getLocator('openProjectIntegrationActionsButton').first();
      if (
        !(await actionsButton
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true)
          .catch(() => false))
      ) {
        return false;
      }
      await actionsButton.scrollIntoViewIfNeeded();
      await actionsButton.click();
      const menuItem = this.getLocator(menuItemKey);
      const visible = await menuItem
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      await this.page.keyboard.press('Escape').catch(() => undefined);
      return visible;
    } catch (error: unknown) {
      logDebug('[Nextcloud Apps] isRowActionAvailable failed:', getErrorMessage(error));
      return false;
    }
  }

  private async rowActionTarget(buttonKey: string, menuItemKey: string): Promise<Locator> {
    await this.findOpenProjectIntegrationApp();
    const primary = this.getLocator(buttonKey);
    if (await primary.isVisible({ timeout: 2000 }).catch(() => false)) {
      return primary;
    }

    const actionsButton = this.getLocator('openProjectIntegrationActionsButton').first();
    await actionsButton.waitFor({ state: 'visible', timeout: 10000 });
    await actionsButton.click();
    const menuItem = this.getLocator(menuItemKey);
    await menuItem.waitFor({ state: 'visible', timeout: 10000 });
    return menuItem;
  }

  async isDisableButtonPresentForOpenProjectIntegration(): Promise<boolean> {
    return this.isRowActionAvailable(
      'openProjectIntegrationDisableButton',
      'openProjectIntegrationDisableMenuItem',
    );
  }

  async isEnableButtonPresentForOpenProjectIntegration(): Promise<boolean> {
    return this.isRowActionAvailable(
      'openProjectIntegrationEnableButton',
      'openProjectIntegrationEnableMenuItem',
    );
  }

  async isUpdateButtonPresentForOpenProjectIntegration(): Promise<boolean> {
    try {
      await this.findOpenProjectIntegrationApp();
      const updateButton = this.getLocator('openProjectIntegrationUpdateButton');
      return await updateButton.isVisible({ timeout: 5000 }).catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Triggers marketplace Update for the OpenProject Integration app.
   * Password re-auth may be required; Apps UI can briefly 502 while the app reloads.
   * Polls until the Update button is gone (version applied), not only until a POST returns.
   */
  async clickUpdateOpenProjectIntegration(adminPassword: string): Promise<void> {
    await this.findOpenProjectIntegrationApp();
    const updateButton = this.getLocator('openProjectIntegrationUpdateButton');
    await updateButton.waitFor({ state: 'visible', timeout: 10000 });
    const versionBefore = await this.getOpenProjectIntegrationAppVersion();
    logInfo('[Nextcloud Apps] Updating OpenProject Integration from', versionBefore);
    await updateButton.click();
    await this.confirmPasswordDialog(adminPassword);

    await Promise.race([
      this.page.waitForResponse(
        (response) =>
          (response.url().includes('/apps/appstore/api/v1/apps/update') ||
            response.url().includes('/apps/appstore/api/v1/apps/enable') ||
            response.url().includes('/settings/apps/update') ||
            response.url().includes('/apps/appstore/api/v1/apps')) &&
          (response.request().method() === 'POST' || response.request().method() === 'PUT'),
        { timeout: 180000 },
      ),
      updateButton.waitFor({ state: 'hidden', timeout: 180000 }),
    ]).catch(() => {
      logDebug('[Nextcloud Apps] Update response/button hide wait timed out; continuing');
    });

    await this.waitForAppsUiRecovered();

    // App Store may close the dialog before files are swapped; poll until Update is gone
    // and the reported version changes (or Disable is back on Active apps).
    await expect
      .poll(
        async () => {
          await this.navigateTo();
          await this.waitForReady();
          await this.findOpenProjectIntegrationApp();
          const stillUpdate = await this.getLocator('openProjectIntegrationUpdateButton')
            .isVisible({ timeout: 2000 })
            .catch(() => false);
          const versionNow = await this.getOpenProjectIntegrationAppVersion();
          if (!stillUpdate && versionNow !== versionBefore) {
            logInfo('[Nextcloud Apps] Update complete; version now', versionNow);
            return true;
          }
          logDebug(
            '[Nextcloud Apps] Waiting for update to finish; version=',
            versionNow,
            'updateBtn=',
            String(stillUpdate),
          );
          return false;
        },
        { timeout: 180_000, intervals: [5000] },
      )
      .toBe(true);
  }

  async clickDisableOpenProjectIntegration(): Promise<void> {
    logInfo('[Nextcloud Apps] Disabling OpenProject Integration');
    const target = await this.rowActionTarget(
      'openProjectIntegrationDisableButton',
      'openProjectIntegrationDisableMenuItem',
    );
    const disableWait = this.page
      .waitForResponse(
        (response) =>
          response.url().includes('/apps/appstore/api/v1/apps/disable') &&
          response.request().method() === 'POST',
        { timeout: 20000 },
      )
      .catch(() => undefined);

    await Promise.all([disableWait, target.click()]);

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
    logInfo('[Nextcloud Apps] Enabling OpenProject Integration');
    const target = await this.rowActionTarget(
      'openProjectIntegrationEnableButton',
      'openProjectIntegrationEnableMenuItem',
    );
    await target.click();
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

  async isDownloadAndEnableButtonPresentForOpenProjectIntegration(): Promise<boolean> {
    try {
      await this.findOpenProjectIntegrationApp();
      const downloadButton = this.getLocator('openProjectIntegrationDownloadEnableButton');
      if (await downloadButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        return true;
      }

      const actionsButton = this.getLocator('openProjectIntegrationActionsButton').first();
      if (!(await actionsButton.isVisible({ timeout: 3000 }).catch(() => false))) {
        return false;
      }
      await actionsButton.click();
      const downloadMenuItem = this.getLocator('openProjectIntegrationDownloadEnableMenuItem').first();
      const visible = await downloadMenuItem.isVisible({ timeout: 5000 }).catch(() => false);
      await this.page.keyboard.press('Escape').catch(() => undefined);
      return visible;
    } catch {
      return false;
    }
  }

  async clickRemoveOpenProjectIntegration(adminPassword: string): Promise<void> {
    await this.findOpenProjectIntegrationApp();
    logInfo('[Nextcloud Apps] Removing OpenProject Integration');

    const directRemove = this.getLocator('openProjectIntegrationRemoveButton');
    if (await directRemove.isVisible({ timeout: 2000 }).catch(() => false)) {
      await directRemove.click();
    } else {
      const actionsButton = this.getLocator('openProjectIntegrationActionsButton');
      await actionsButton.waitFor({ state: 'visible', timeout: 10000 });
      await actionsButton.click();
      const removeItem = this.getLocator('openProjectIntegrationRemoveMenuItem');
      await removeItem.waitFor({ state: 'visible', timeout: 10000 });
      await removeItem.click();
    }

    await this.confirmPasswordDialog(adminPassword);

    await Promise.race([
      this.page.waitForResponse(
        (response) =>
          (response.url().includes('/apps/appstore/api/v1/apps/remove') ||
            response.url().includes('/apps/appstore/api/v1/apps/uninstall')) &&
          response.request().method() === 'POST',
        { timeout: 60000 },
      ),
      this.getLocator('openProjectIntegrationAppRow').waitFor({
        state: 'hidden',
        timeout: 60000,
      }),
    ]).catch(() => {
      logDebug('[Nextcloud Apps] Remove response/row hide wait timed out; continuing');
    });
  }

  async clickDownloadAndEnableOpenProjectIntegration(adminPassword: string): Promise<void> {
    await this.findOpenProjectIntegrationApp();
    logInfo('[Nextcloud Apps] Downloading and enabling OpenProject Integration');

    const downloadButton = this.getLocator('openProjectIntegrationDownloadEnableButton');
    if (await downloadButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await downloadButton.click();
    } else {
      const actionsButton = this.getLocator('openProjectIntegrationActionsButton').first();
      await actionsButton.waitFor({ state: 'visible', timeout: 15000 });
      await actionsButton.click();
      const downloadMenuItem = this.getLocator('openProjectIntegrationDownloadEnableMenuItem').first();
      await downloadMenuItem.waitFor({ state: 'visible', timeout: 15000 });
      await downloadMenuItem.click();
    }

    await this.confirmPasswordDialog(adminPassword);

    await Promise.race([
      this.page.waitForResponse(
        (response) =>
          (response.url().includes('/apps/appstore/api/v1/apps/enable') ||
            response.url().includes('/apps/appstore/api/v1/apps/download') ||
            response.url().includes('/settings/apps/enable')) &&
          response.request().method() === 'POST',
        { timeout: 180000 },
      ),
      this.getLocator('openProjectIntegrationDisableButton').waitFor({
        state: 'visible',
        timeout: 180000,
      }),
    ]).catch(() => {
      logDebug('[Nextcloud Apps] Download/enable response wait timed out; continuing');
    });

    await this.waitForAppsUiRecovered();
  }

  private async isAppsUiUnavailable(): Promise<boolean> {
    const bodyText = (await this.getLocator('pageBody').innerText().catch(() => '')).trim();
    return (
      bodyText.length < 200 && /bad gateway|502|service unavailable|503/i.test(bodyText)
    );
  }

  /** Poll Active apps until Nextcloud serves the Apps UI again (app enable can briefly 502). */
  async waitForAppsUiRecovered(timeoutMs = 240_000): Promise<void> {
    await expect
      .poll(
        async () => {
          try {
            await this.navigateTo();
            if (!(await this.isAppsUiUnavailable())) {
              await this.waitForReady();
              return true;
            }
            logWarn('[Nextcloud Apps] Apps UI unavailable; retrying');
          } catch (error: unknown) {
            logDebug('[Nextcloud Apps] Recovery poll failed:', getErrorMessage(error));
          }
          return false;
        },
        { timeout: timeoutMs, intervals: [2000, 4000, 8000] },
      )
      .toBe(true);
  }

  /**
   * Helm pre-installs the app, so marketplace "Download and enable" is hidden until Remove.
   * Disable (if needed) → Disabled apps → Remove, then return to Integration ready for download.
   */
  async removeOpenProjectIntegrationIfInstalled(adminPassword: string): Promise<void> {
    if (await this.isDownloadAndEnableButtonPresentForOpenProjectIntegration()) {
      logInfo('[Nextcloud Apps] OpenProject Integration already uninstalled; Download and enable ready');
      return;
    }

    // Update CTA replaces primary Disable when a newer release is available; still enabled.
    if (
      (await this.isDisableButtonPresentForOpenProjectIntegration()) ||
      (await this.isUpdateButtonPresentForOpenProjectIntegration())
    ) {
      logInfo('[Nextcloud Apps] App enabled; disabling before Remove');
      await this.clickDisableOpenProjectIntegration();
    }

    logInfo('[Nextcloud Apps] Opening Disabled apps to Remove OpenProject Integration');
    await this.navigateToDisabledApps();
    await this.waitForDisabledAppsReady();

    const stillInstalled = await this.findOpenProjectIntegrationApp()
      .then(() => true)
      .catch(() => false);

    if (!stillInstalled) {
      logInfo('[Nextcloud Apps] App not on Disabled apps; treating as already removed');
      await this.navigateToIntegrationsApps();
      await this.waitForIntegrationsAppsReady();
      await this.findOpenProjectIntegrationApp();
      return;
    }

    await this.clickRemoveOpenProjectIntegration(adminPassword);

    await this.navigateToIntegrationsApps();
    await this.waitForIntegrationsAppsReady();
    await this.findOpenProjectIntegrationApp();
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
   * Only re-enables an already-installed app from Disabled — never marketplace-downloads
   * (that can downgrade a git/nightly deploy to the App Store release).
   */
  async ensureOpenProjectIntegrationEnabled(adminPassword: string): Promise<void> {
    try {
      await this.waitForAppsUiRecovered();

      // Update CTA replaces Disable on Active apps when a newer release is available.
      if (
        (await this.isDisableButtonPresentForOpenProjectIntegration()) ||
        (await this.isUpdateButtonPresentForOpenProjectIntegration())
      ) {
        logDebug('[Nextcloud Apps] OpenProject Integration already enabled');
        return;
      }

      logWarn('[Nextcloud Apps] OpenProject Integration not on Active apps; enabling from Disabled');
      await this.navigateToDisabledApps();
      await this.waitForDisabledAppsReady();
      await this.clickEnableOpenProjectIntegration(adminPassword);
      await this.navigateTo();
      await this.waitForReady();

      const enabled =
        (await this.isDisableButtonPresentForOpenProjectIntegration()) ||
        (await this.isUpdateButtonPresentForOpenProjectIntegration());
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
