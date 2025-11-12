import { Page } from '@playwright/test';
import { BasePage } from './base/BasePage';

/**
 * PageObject for Nextcloud application
 */
export class NextcloudPage extends BasePage {
  constructor(page: Page) {
    super(page, 'nextcloud.json');
  }

  protected getUrlEnvVar(): string {
    return 'NEXTCLOUD_URL';
  }

  /**
   * Login to Nextcloud
   */
  async login(username: string = 'admin', password: string = 'admin'): Promise<void> {
    await this.navigateTo();
    await this.getLocator('usernameInput').fill(username);
    await this.getLocator('passwordInput').fill(password);
    await this.getLocator('loginButton').click();
    // Wait for login to process
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * Navigate to the integration_openproject app
   */
  async navigateToIntegrationApp(): Promise<void> {
    const baseUrl = process.env.NEXTCLOUD_URL || this.locators.url;
    await this.page.goto(`${baseUrl}/index.php/apps/integration_openproject`, { 
      waitUntil: 'domcontentloaded' 
    });
  }

  /**
   * Check if integration app is accessible
   */
  async isIntegrationAppVisible(): Promise<boolean> {
    try {
      // Check if we're on the integration app page
      const currentUrl = this.page.url();
      if (currentUrl.includes('integration_openproject')) {
        return true;
      }
      // Try to find integration app title or any OpenProject-related content
      const title = await this.page.locator('h2:has-text("OpenProject"), h1:has-text("OpenProject"), [data-app="integration_openproject"]').first();
      if (await title.isVisible({ timeout: 3000 }).catch(() => false)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if user is logged in
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      // Check if login form is gone (more reliable than finding user menu)
      const loginForm = await this.page.locator('#user, input[name="user"]').count();
      if (loginForm === 0) {
        return true; // Login form not found, likely logged in
      }
      // Also try to find any user menu element
      const userMenu = await this.page.locator('.header-menu, [data-user-menu], #user-menu, .avatardiv, .user-menu').first();
      if (await userMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

