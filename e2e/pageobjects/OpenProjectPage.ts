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

  /**
   * Verify if we've been redirected to Keycloak login page
   */
  private async isRedirectedToKeycloak(): Promise<boolean> {
    try {
      // Wait a bit for any redirects to complete
      await this.page.waitForTimeout(1500);
      
      // Check if URL contains keycloak.test
      const currentUrl = this.page.url();
      if (!currentUrl.includes('keycloak.test')) {
        return false;
      }
      
      // Check if Keycloak login form is visible (username input field)
      // Keycloak uses different selectors, try multiple
      const usernameInput = this.page.locator(
        'input[name="username"], input#username, input[type="text"][name*="user"], input[placeholder*="username" i]'
      ).first();
      
      const isLoginFormVisible = await usernameInput.isVisible({ timeout: 3000 }).catch(() => false);
      
      if (isLoginFormVisible) {
        console.log(`[DEBUG] Verified: Redirected to Keycloak login page at ${currentUrl}`);
        return true;
      }
      
      // Also check if we're on a Keycloak realm page (might be loading)
      if (currentUrl.includes('/realms/')) {
        console.log(`[DEBUG] On Keycloak realm page, waiting for login form...`);
        await this.page.waitForTimeout(2000);
        return await usernameInput.isVisible({ timeout: 5000 }).catch(() => false);
      }
      
      return false;
    } catch (error) {
      console.log(`[DEBUG] Verification failed: ${error}`);
      return false;
    }
  }

  /**
   * Click on Keycloak authentication button
   */
  async clickKeycloakAuthButton(): Promise<void> {
    // Wait for page to be fully loaded
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(2000); // Give extra time for dynamic content to render
    
    // Find the Keycloak button
    const keycloakButton = this.page.locator('a.auth-provider-keycloak[href*="/auth/keycloak"]').first();
    
    // Wait for the button to be attached to DOM
    await keycloakButton.waitFor({ state: 'attached', timeout: 15000 });
    
    // Use JavaScript click to trigger the navigation (works when button is not directly clickable)
    await keycloakButton.evaluate((el: HTMLElement) => {
      (el as HTMLAnchorElement).click();
    });
    
    // Wait for navigation to Keycloak
    await this.page.waitForURL(/.*keycloak\.test.*/, { timeout: 10000 });
    
    // Verify we're on the Keycloak login page
    if (!(await this.isRedirectedToKeycloak())) {
      throw new Error('Failed to redirect to Keycloak login page');
    }
  }

  /**
   * Verify user profile button is present and shows the expected user name
   * @param expectedName - Expected user name (e.g., "Alice Hansen")
   */
  async verifyUserProfileButton(expectedName: string): Promise<boolean> {
    try {
      // Wait for page to be fully loaded
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(2000);
      
      // Find the button that contains the opce-principal element
      // The button structure: <button> contains <opce-principal>
      // Try multiple selectors to find the button
      const buttonSelectors = [
        'button:has(opce-principal[data-test-selector="op-principal"])',
        'button.op-app-header--primer-button:has(opce-principal)',
        'button[data-show-dialog-id]:has(opce-principal)',
        'button:has(.op-top-menu-user-avatar)'
      ];
      
      let profileButton = null;
      for (const selector of buttonSelectors) {
        try {
          const locator = this.page.locator(selector).first();
          await locator.waitFor({ state: 'visible', timeout: 3000 });
          profileButton = locator;
          console.log(`[DEBUG] Found user profile button with selector: ${selector}`);
          break;
        } catch {
          continue;
        }
      }
      
      if (!profileButton) {
        console.log(`[DEBUG] User profile button not found`);
        return false;
      }
      
      // Click the button to open the menu/dialog
      console.log(`[DEBUG] Clicking user profile button`);
      await profileButton.click();
      
      // Wait for the dialog to appear (it has data-show-dialog-id attribute)
      await this.page.waitForTimeout(1500);
      
      // Wait for the menu/dialog to appear and check for the user name
      // Look for the div with class "text-bold" containing the expected name
      const userNameDiv = this.page.locator('div.text-bold').first();
      await userNameDiv.waitFor({ state: 'visible', timeout: 5000 });
      
      const userNameText = await userNameDiv.textContent();
      console.log(`[DEBUG] Found user name text in menu: "${userNameText}"`);
      
      if (userNameText && userNameText.trim() === expectedName) {
        console.log(`[DEBUG] User name matches expected: "${expectedName}"`);
        return true;
      }
      
      // Also check if the name is contained (case-insensitive)
      if (userNameText && userNameText.trim().toLowerCase().includes(expectedName.toLowerCase())) {
        console.log(`[DEBUG] User name contains expected: "${expectedName}"`);
        return true;
      }
      
      // Try to find the name anywhere in the dialog
      const dialog = this.page.locator('[role="dialog"], [data-view-component="true"]').first();
      const dialogText = await dialog.textContent().catch(() => '');
      console.log(`[DEBUG] Dialog content: ${dialogText}`);
      
      if (dialogText && dialogText.includes(expectedName)) {
        return true;
      }
      
      return false;
    } catch (error) {
      console.log(`[DEBUG] Error verifying user profile button: ${error}`);
      return false;
    }
  }

  /**
   * Get the user name from the profile button
   */
  async getUserNameFromProfile(): Promise<string | null> {
    try {
      // Ensure page is stable
      await this.page.waitForLoadState('networkidle');
  
      // Locate profile button
      const profileButton = this.page.locator(
        'button:has(opce-principal[data-test-selector="op-principal"])'
      ).first();
  
      await profileButton.waitFor({ state: 'visible', timeout: 10000 });
  
      // Try extracting from attributes before clicking
      const opcePrincipal = profileButton.locator('opce-principal[data-test-selector="op-principal"]').first();
  
      const dataPrincipal = await opcePrincipal.getAttribute('data-principal');
      if (dataPrincipal) {
        try {
          const principal = JSON.parse(dataPrincipal);
          if (principal.name) return principal.name;
        } catch {
          // Ignore invalid JSON
        }
      }
  
      const dataTitle = await opcePrincipal.getAttribute('data-title');
      if (dataTitle) return dataTitle.replace(/^["']|["']$/g, '');
  
      // Click and wait for dialog
      await Promise.all([
        profileButton.click(),
        this.page.waitForSelector('div.text-bold', { state: 'visible', timeout: 5000 })
      ]);
  
      const userName = await this.page.locator('div.text-bold').first().textContent();
      return userName?.trim() || null;
  
    } catch (error) {
      console.log(`[DEBUG] Error getting user name from profile: ${error}`);
      return null;
    }
  }
}

