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
      await this.getLocator('adminConsole').waitFor({ timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

