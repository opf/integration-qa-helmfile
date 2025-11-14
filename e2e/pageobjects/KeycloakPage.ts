import { Page } from '@playwright/test';
import { BasePage } from './base/BasePage';

/**
 * PageObject for Keycloak application
 */
export class KeycloakPage extends BasePage {
  constructor(page: Page) {
    super(page, 'keycloak.json');
  }

  protected getUrlEnvVar(): string {
    return 'KEYCLOAK_URL';
  }

  /**
   * Login to Keycloak admin console
   */
  async login(username: string = 'admin', password: string = 'admin'): Promise<void> {
    await this.navigateTo();
    await this.getLocator('usernameInput').fill(username);
    await this.getLocator('passwordInput').fill(password);
    await this.getLocator('loginButton').click();
    await this.page.waitForURL(/.*\/.*/, { timeout: 10000 });
  }

  /**
   * Navigate to a specific realm
   */
  async navigateToRealm(realmName: string): Promise<void> {
    const baseUrl = process.env.KEYCLOAK_URL || this.locators.url;
    await this.page.goto(`${baseUrl}/admin/${realmName}/console`, { 
      waitUntil: 'domcontentloaded' 
    });
  }

  /**
   * Check if user is logged in
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      // Check if we're on the admin console page by looking for the Manage Realms button
      // or checking the URL pattern
      await this.page.waitForURL(/.*\/admin\/.*\/console.*/, { timeout: 5000 });
      // Also verify the Manage Realms button is present
      await this.getLocator('manageRealmsButton').waitFor({ timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click on Manage Realms button
   */
  async clickManageRealms(): Promise<void> {
    await this.getLocator('manageRealmsButton').click();
  }

  /**
   * Select a realm by clicking on its link
   * @param realmName - Name of the realm to select (e.g., 'opnc')
   */
  async selectRealm(realmName: string): Promise<void> {
    // Wait for the realm link to be visible and click it
    // Match by href attribute (#/opnc) and text content (opnc) for robustness
    const realmLink = this.page.locator(`a[href='#/${realmName}']`).filter({ hasText: realmName });
    await realmLink.waitFor({ state: 'visible', timeout: 10000 });
    await realmLink.click();
    // Wait a bit for the navigation to complete
    await this.page.waitForTimeout(1000);
  }

  /**
   * Verify that the current realm is displayed
   * @param realmName - Expected realm name
   */
  async verifyCurrentRealm(realmName: string): Promise<boolean> {
    try {
      // Wait for the currentRealm span with data-testid to appear on the page
      const currentRealmLocator = this.getLocator('currentRealm');
      await currentRealmLocator.waitFor({ state: 'visible', timeout: 10000 });
      const text = await currentRealmLocator.textContent();
      return text?.trim() === realmName;
    } catch {
      return false;
    }
  }

  /**
   * Click on Clients button in the navigation
   */
  async clickClients(): Promise<void> {
    await this.getLocator('clientsButton').click();
    // Wait for the clients page content to load (hash-based navigation)
    // Wait for at least one client link to appear as an indicator that content loaded
    const nextcloudClient = this.getLocator('nextcloudClientLink');
    await nextcloudClient.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Verify that both Nextcloud and OpenProject clients are present
   */
  async verifyClientsPresent(): Promise<boolean> {
    try {
      // Wait for both client links to be visible
      const nextcloudClient = this.getLocator('nextcloudClientLink');
      const openprojectClient = this.getLocator('openprojectClientLink');
      
      await nextcloudClient.waitFor({ state: 'visible', timeout: 10000 });
      await openprojectClient.waitFor({ state: 'visible', timeout: 10000 });
      
      // Verify they contain the expected text
      const nextcloudText = await nextcloudClient.textContent();
      const openprojectText = await openprojectClient.textContent();
      
      return nextcloudText?.trim() === 'nextcloud' && 
             openprojectText?.trim() === 'openproject';
    } catch {
      return false;
    }
  }
}

