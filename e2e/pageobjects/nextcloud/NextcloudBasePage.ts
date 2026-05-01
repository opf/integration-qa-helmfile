import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';
import { testConfig } from '../../utils/config';
import { resolveServiceNavigationUrl } from '../../utils/url-helpers';
import { getErrorMessage } from '../../utils/error-utils';
import { logDebug, logWarn } from '../../utils/logger';

export abstract class NextcloudBasePage extends BasePage {
  constructor(page: Page) {
    super(page, 'nextcloud.json');
  }

  private async hasVisibleFirstRunWizardElement(): Promise<boolean> {
    const locatorKeys = [
      'firstRunWizardSkipButton',
      'firstRunWizardIntroVideo',
      'firstRunWizardCloseButton',
      'firstRunWizardDialog',
      'firstRunWizard',
    ];

    for (const key of locatorKeys) {
      const isVisible = await this.getLocator(key).first().isVisible().catch(() => false);
      if (isVisible) return true;
    }

    return false;
  }

  private async waitForFirstRunWizard(appearanceTimeout: number): Promise<boolean> {
    const deadline = Date.now() + appearanceTimeout;

    while (Date.now() < deadline) {
      if (await this.hasVisibleFirstRunWizardElement()) return true;
      await this.page.waitForTimeout(250);
    }

    return false;
  }

  protected getUrlEnvVar(): string {
    return 'NEXTCLOUD_URL';
  }

  protected resolveNavigationUrl(): string {
    return resolveServiceNavigationUrl(
      process.env.NEXTCLOUD_URL,
      process.env.NEXTCLOUD_HOST,
      testConfig.nextcloud.host,
      this.locators.url,
    );
  }

  protected async dismissFirstRunWizardIfPresent(appearanceTimeout = 5000): Promise<boolean> {
    const wizardAppeared = await this.waitForFirstRunWizard(appearanceTimeout);
    if (!wizardAppeared) {
      logDebug('[Nextcloud] First-run wizard not shown');
      return false;
    }

    logDebug('[Nextcloud] First-run wizard detected, dismissing it');

    try {
      const wizard = this.getLocator('firstRunWizardDialog').first();
      const skipButton = this.getLocator('firstRunWizardSkipButton').first();
      const closeButton = this.getLocator('firstRunWizardCloseButton').first();
      const skipVisible = await skipButton.waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (skipVisible) {
        await skipButton.click({ timeout: 5000 }).catch((error: unknown) => {
          logDebug('[Nextcloud] First-run wizard skip button was not clicked:', getErrorMessage(error));
        });
      }

      await closeButton.waitFor({ state: 'visible', timeout: 20000 });
      const dismissRequest = this.page.waitForResponse((response) => {
        return response.url().includes('/apps/firstrunwizard/wizard') &&
          response.request().method() === 'DELETE';
      }, { timeout: 10000 }).catch((error: unknown) => {
        logDebug('[Nextcloud] First-run wizard dismiss request was not observed:', getErrorMessage(error));
        return null;
      });
      await closeButton.click({ timeout: 5000 });
      await dismissRequest;
      await wizard.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
        return closeButton.waitFor({ state: 'hidden', timeout: 5000 });
      });
      return true;
    } catch (error: unknown) {
      logWarn('[Nextcloud] Failed to dismiss first-run wizard:', getErrorMessage(error));
      throw error;
    }
  }

  protected get baseUrl(): string {
    return resolveServiceNavigationUrl(
      process.env.NEXTCLOUD_URL,
      process.env.NEXTCLOUD_HOST,
      testConfig.nextcloud.host,
      this.locators.url,
    );
  }
}
