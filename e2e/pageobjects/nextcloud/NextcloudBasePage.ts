import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';
import { testConfig } from '../../utils/config';
import { resolveServiceNavigationUrl } from '../../utils/url-helpers';
import { getErrorMessage } from '../../utils/error-utils';
import { logDebug, logWarn } from '../../utils/logger';

/** Cap individual dismiss actions so optional overlays cannot burn the full test timeout. */
const DISMISS_ACTION_TIMEOUT_MS = 3000;

export abstract class NextcloudBasePage extends BasePage {
  constructor(page: Page) {
    super(page, 'nextcloud.json');
  }

  /**
   * Only the scoped firstrunwizard root counts as present.
   * Bare role=dialog / substring "Skip" matches caused false positives on OIDC settings.
   */
  private async isFirstRunWizardVisible(): Promise<boolean> {
    return this.getLocator('firstRunWizard').first().isVisible().catch(() => false);
  }

  private async waitForFirstRunWizard(appearanceTimeout: number): Promise<boolean> {
    const cappedAppearance = Math.min(appearanceTimeout, 3000);
    const deadline = Date.now() + cappedAppearance;

    while (Date.now() < deadline) {
      if (await this.isFirstRunWizardVisible()) return true;
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

  /**
   * Optionally dismiss Nextcloud's first-run wizard when `#firstrunwizard` is visible.
   * Soft: never throws — false positives / dismiss failures must not fail the test.
   */
  protected async dismissFirstRunWizardIfPresent(appearanceTimeout = 5000): Promise<boolean> {
    try {
      const wizardAppeared = await this.waitForFirstRunWizard(appearanceTimeout);
      if (!wizardAppeared) {
        logDebug('[Nextcloud] First-run wizard not shown');
        return false;
      }

      logDebug('[Nextcloud] First-run wizard detected, dismissing it');

      const wizard = this.getLocator('firstRunWizard').first();
      const skipButton = this.getLocator('firstRunWizardSkipButton').first();
      const closeButton = this.getLocator('firstRunWizardCloseButton').first();

      const skipVisible = await skipButton
        .waitFor({ state: 'visible', timeout: DISMISS_ACTION_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);

      if (skipVisible) {
        await skipButton.click({ timeout: DISMISS_ACTION_TIMEOUT_MS }).catch((error: unknown) => {
          logDebug(
            '[Nextcloud] First-run wizard skip button was not clicked:',
            getErrorMessage(error),
          );
        });
      }

      const closeVisible = await closeButton
        .waitFor({ state: 'visible', timeout: DISMISS_ACTION_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);

      if (closeVisible) {
        const dismissRequest = this.page
          .waitForResponse(
            (response) => {
              return (
                response.url().includes('/apps/firstrunwizard/wizard') &&
                response.request().method() === 'DELETE'
              );
            },
            { timeout: DISMISS_ACTION_TIMEOUT_MS },
          )
          .catch((error: unknown) => {
            logDebug(
              '[Nextcloud] First-run wizard dismiss request was not observed:',
              getErrorMessage(error),
            );
            return null;
          });
        await closeButton.click({ timeout: DISMISS_ACTION_TIMEOUT_MS }).catch((error: unknown) => {
          logDebug(
            '[Nextcloud] First-run wizard close button was not clicked:',
            getErrorMessage(error),
          );
        });
        await dismissRequest;
      }

      await wizard.waitFor({ state: 'hidden', timeout: DISMISS_ACTION_TIMEOUT_MS }).catch(() => {
        return closeButton.waitFor({ state: 'hidden', timeout: DISMISS_ACTION_TIMEOUT_MS });
      });
      return true;
    } catch (error: unknown) {
      logWarn('[Nextcloud] Failed to dismiss first-run wizard:', getErrorMessage(error));
      return false;
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
