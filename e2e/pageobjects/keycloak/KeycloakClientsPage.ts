import { Page } from '@playwright/test';
import { KeycloakBasePage } from './KeycloakBasePage';

export class KeycloakClientsPage extends KeycloakBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/admin\/.*\/console\/#\/.*\/clients/, { timeout: 10000 });
    const nextcloudClient = this.getLocator('nextcloudClientLink');
    await nextcloudClient.waitFor({ state: 'visible', timeout: 10000 });
  }

  async verifyClientsPresent(): Promise<boolean> {
    try {
      const nextcloudClient = this.getLocator('nextcloudClientLink');
      const openprojectClient = this.getLocator('openprojectClientLink');
      
      await nextcloudClient.waitFor({ state: 'visible', timeout: 10000 });
      await openprojectClient.waitFor({ state: 'visible', timeout: 10000 });
      
      const nextcloudText = await nextcloudClient.textContent();
      const openprojectText = await openprojectClient.textContent();
      
      return nextcloudText?.trim() === 'nextcloud' && 
             openprojectText?.trim() === 'openproject';
    } catch {
      return false;
    }
  }
}

