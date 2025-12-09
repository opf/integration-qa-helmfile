import { Page } from '@playwright/test';
import { KeycloakBasePage } from './KeycloakBasePage';

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
      console.log('[CLIENTS VERIFICATION] Starting client verification...');
      console.log(`[CLIENTS VERIFICATION] Current URL: ${this.page.url()}`);
      
      // Wait for page to be fully loaded
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(1000);
      
      const nextcloudClient = this.getLocator('nextcloudClientLink');
      const openprojectClient = this.getLocator('openprojectClientLink');
      
      console.log('[CLIENTS VERIFICATION] Waiting for nextcloud client...');
      await nextcloudClient.waitFor({ state: 'visible', timeout: 15000 });
      console.log('[CLIENTS VERIFICATION] Nextcloud client found');
      
      console.log('[CLIENTS VERIFICATION] Waiting for openproject client...');
      await openprojectClient.waitFor({ state: 'visible', timeout: 15000 });
      console.log('[CLIENTS VERIFICATION] Openproject client found');
      
      // Get text content - try multiple ways
      const nextcloudText = await nextcloudClient.textContent();
      const openprojectText = await openprojectClient.textContent();
      
      console.log(`[CLIENTS VERIFICATION] Nextcloud text: "${nextcloudText}"`);
      console.log(`[CLIENTS VERIFICATION] Openproject text: "${openprojectText}"`);
      
      // Also try getting text from inner text or from a child element
      const nextcloudTextTrimmed = nextcloudText?.trim().toLowerCase();
      const openprojectTextTrimmed = openprojectText?.trim().toLowerCase();
      
      // Check if the text contains the expected client names (more flexible)
      const nextcloudMatch = nextcloudTextTrimmed === 'nextcloud' || 
                            nextcloudTextTrimmed?.includes('nextcloud');
      const openprojectMatch = openprojectTextTrimmed === 'openproject' || 
                              openprojectTextTrimmed?.includes('openproject');
      
      console.log(`[CLIENTS VERIFICATION] Nextcloud match: ${nextcloudMatch}`);
      console.log(`[CLIENTS VERIFICATION] Openproject match: ${openprojectMatch}`);
      
      // Alternative: Check if links are visible and contain expected href patterns
      const nextcloudHref = await nextcloudClient.getAttribute('href');
      const openprojectHref = await openprojectClient.getAttribute('href');
      
      console.log(`[CLIENTS VERIFICATION] Nextcloud href: ${nextcloudHref}`);
      console.log(`[CLIENTS VERIFICATION] Openproject href: ${openprojectHref}`);
      
      const result = (nextcloudMatch || nextcloudHref?.includes('nextcloud')) && 
                    (openprojectMatch || openprojectHref?.includes('openproject'));
      
      console.log(`[CLIENTS VERIFICATION] Final result: ${result}`);
      return result;
    } catch (error) {
      console.error('[CLIENTS VERIFICATION] Error verifying clients:', error);
      // Take a screenshot for debugging
      await this.screenshot('clients-verification-error.png').catch(() => {});
      return false;
    }
  }
}

