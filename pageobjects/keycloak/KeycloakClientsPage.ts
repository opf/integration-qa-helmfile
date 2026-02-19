import { Page } from '@playwright/test';
import { KeycloakBasePage } from './KeycloakBasePage';
import { getErrorMessage } from '../../utils/error-utils';
import { logDebug, logError } from '../../utils/logger';

export class KeycloakClientsPage extends KeycloakBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/admin\/.*\/console\/#\/.*\/clients/, { timeout: 15000 });
    // Wait for the clients table/list to be visible
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(1000); // Additional wait for dynamic content
    
    // Try to find clients using multiple strategies
    const nextcloudClient = this.getLocator('nextcloudClientLink');
    await nextcloudClient.waitFor({ state: 'visible', timeout: 15000 });
  }

  async verifyClientsPresent(): Promise<boolean> {
    try {
      logDebug('[CLIENTS VERIFICATION] Starting client verification...');
      logDebug('[CLIENTS VERIFICATION] Current URL: %s', this.page.url());
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(1000);
      const nextcloudClient = this.getLocator('nextcloudClientLink');
      const openprojectClient = this.getLocator('openprojectClientLink');
      logDebug('[CLIENTS VERIFICATION] Waiting for nextcloud client...');
      await nextcloudClient.waitFor({ state: 'visible', timeout: 15000 });
      logDebug('[CLIENTS VERIFICATION] Nextcloud client found');
      logDebug('[CLIENTS VERIFICATION] Waiting for openproject client...');
      await openprojectClient.waitFor({ state: 'visible', timeout: 15000 });
      logDebug('[CLIENTS VERIFICATION] Openproject client found');
      const nextcloudText = await nextcloudClient.textContent();
      const openprojectText = await openprojectClient.textContent();
      logDebug('[CLIENTS VERIFICATION] Nextcloud text: "%s"', nextcloudText);
      logDebug('[CLIENTS VERIFICATION] Openproject text: "%s"', openprojectText);
      const nextcloudTextTrimmed = nextcloudText?.trim().toLowerCase();
      const openprojectTextTrimmed = openprojectText?.trim().toLowerCase();
      const nextcloudMatch = nextcloudTextTrimmed === 'nextcloud' ||
                            nextcloudTextTrimmed?.includes('nextcloud');
      const openprojectMatch = openprojectTextTrimmed === 'openproject' ||
                              openprojectTextTrimmed?.includes('openproject');
      logDebug('[CLIENTS VERIFICATION] Nextcloud match: %s', nextcloudMatch);
      logDebug('[CLIENTS VERIFICATION] Openproject match: %s', openprojectMatch);
      const nextcloudHref = await nextcloudClient.getAttribute('href');
      const openprojectHref = await openprojectClient.getAttribute('href');
      logDebug('[CLIENTS VERIFICATION] Nextcloud href: %s', nextcloudHref);
      logDebug('[CLIENTS VERIFICATION] Openproject href: %s', openprojectHref);
      const result = (nextcloudMatch || nextcloudHref?.includes('nextcloud')) &&
                    (openprojectMatch || openprojectHref?.includes('openproject'));
      logDebug('[CLIENTS VERIFICATION] Final result: %s', result);
      return result;
    } catch (error: unknown) {
      logError('[CLIENTS VERIFICATION] Error verifying clients:', getErrorMessage(error));
      // Take a screenshot for debugging
      await this.screenshot('clients-verification-error.png').catch(() => {});
      return false;
    }
  }
}

