import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { getErrorMessage } from '../../utils/error-utils';
import { logInfo, logWarn } from '../../utils/logger';

/** Page object for Nextcloud Personal Settings → OpenProject section (OAuth2 disconnect/connect). */
export class NextcloudPersonalSettingsPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    const url = `${this.baseUrl}/index.php/settings/user/openproject`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/settings\/user\/openproject.*/, { timeout: 15000 });
    await this.getLocator('ncPersonalSettingsOpenProjectSection')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  }

  async isConnected(): Promise<boolean> {
    const disconnect = this.getLocator('ncPersonalSettingsDisconnectButton').first();
    return disconnect.isVisible({ timeout: 3000 }).catch(() => false);
  }

  async waitForConnected(timeoutMs = 30000): Promise<void> {
    await this.getLocator('ncPersonalSettingsDisconnectButton')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
    const label = this.getLocator('ncPersonalSettingsConnectedLabel').first();
    await label.waitFor({ state: 'visible', timeout: 10000 });
  }

  async waitForDisconnected(timeoutMs = 15000): Promise<void> {
    await this.getLocator('ncPersonalSettingsConnectButton')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
  }

  async clickConnectToOpenProject(): Promise<void> {
    // First-run wizard can intercept pointer events on first login.
    await this.dismissFirstRunWizardIfPresent(5000);
    const connect = this.getLocator('ncPersonalSettingsConnectButton').first();
    await connect.waitFor({ state: 'visible', timeout: 15000 });
    await connect.click();
  }

  async disconnectOpenProject(): Promise<void> {
    const disconnect = this.getLocator('ncPersonalSettingsDisconnectButton').first();
    await disconnect.waitFor({ state: 'visible', timeout: 15000 });
    await disconnect.click();

    const success = this.getLocator('ncPersonalSettingsDisconnectSuccessMessage').first();
    try {
      await success.waitFor({ state: 'visible', timeout: 10000 });
      logInfo('Nextcloud personal settings: OpenProject options saved after disconnect');
    } catch (error: unknown) {
      logWarn(
        'Disconnect success toast not seen; verifying disconnected UI state: %s',
        getErrorMessage(error),
      );
    }

    await this.waitForDisconnected();
  }
}
