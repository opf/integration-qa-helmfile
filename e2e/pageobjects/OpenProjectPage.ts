import { Page } from '@playwright/test';
import { BasePage } from './base/BasePage';

/**
 * PageObject for OpenProject application
 */
export class OpenProjectPage extends BasePage {
  constructor(page: Page) {
    super(page, 'openproject.json');
  }

  protected getUrlEnvVar(): string {
    return 'OPENPROJECT_URL';
  }

  /**
   * Login to OpenProject
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
   * Check if user is logged in
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      // Check if login form is gone (more reliable than finding user menu)
      const loginForm = await this.page.locator('#login-form, input[name="username"]').count();
      if (loginForm === 0) {
        return true; // Login form not found, likely logged in
      }
      // Also try to find user menu or any logged-in indicator
      const userMenu = await this.page.locator('[data-test-selector="op-user-menu"], .user-menu, [aria-label*="Account"], [aria-label*="User"]').first();
      if (await userMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Navigate to a specific path
   */
  async navigateToPath(path: string): Promise<void> {
    const baseUrl = process.env.OPENPROJECT_URL || this.locators.url.replace('/login', '');
    await this.page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  }
}

