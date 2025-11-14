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

  /**
   * Close welcome message if present
   */
  async closeWelcomeMessage(): Promise<void> {
    try {
      // Try multiple selectors for welcome message close button
      const closeSelectors = [
        '.welcome .close',
        '.modal__close',
        '[aria-label*="close" i]',
        '[aria-label*="Close"]',
        'button[aria-label*="close" i]',
        'button[aria-label*="Close"]'
      ];
      
      for (const selector of closeSelectors) {
        const closeButton = this.page.locator(selector).first();
        if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await closeButton.click();
          await this.page.waitForTimeout(500);
          return;
        }
      }
    } catch {
      // Welcome message might not be present, ignore
    }
  }

  /**
   * Click on profile icon in top right
   */
  async clickProfileIcon(): Promise<void> {
    await this.getLocator('profileIcon').click();
    // Wait for menu to open
    await this.page.waitForTimeout(500);
  }

  /**
   * Click on Administration settings link
   */
  async clickAdministrationSettings(): Promise<void> {
    await this.getLocator('administrationSettingsLink').click();
    // Wait for navigation
    await this.page.waitForURL(/.*\/settings\/admin.*/, { timeout: 10000 });
  }

  /**
   * Click on OpenID Connect link in settings
   */
  async clickOpenIDConnect(): Promise<void> {
    await this.getLocator('openIdConnectLink').waitFor({ state: 'visible', timeout: 10000 });
    await this.getLocator('openIdConnectLink').click();
    // Wait for OpenID Connect page to load
    await this.page.waitForURL(/.*\/settings\/admin\/user_oidc.*/, { timeout: 10000 });
    await this.page.waitForTimeout(1000);
  }

  /**
   * Verify Keycloak provider details are present
   */
  async verifyKeycloakProviderDetails(): Promise<boolean> {
    try {
      // Wait for provider details section
      const detailsSection = this.getLocator('keycloakProviderDetails');
      await detailsSection.waitFor({ state: 'visible', timeout: 10000 });
      
      // Verify provider name
      const providerNameLocator = detailsSection.locator('h3');
      const providerName = await providerNameLocator.textContent();
      if (providerName?.trim().toLowerCase() !== 'keycloak') {
        return false;
      }

      // Verify Client ID - find label with text "Client ID" and get next sibling span
      const clientIdLabel = detailsSection.locator('label:has-text("Client ID")');
      const clientId = await clientIdLabel.evaluate((el) => {
        const nextSpan = el.nextElementSibling;
        return nextSpan?.tagName === 'SPAN' ? nextSpan.textContent : null;
      });
      if (clientId?.trim() !== 'nextcloud') {
        return false;
      }

      // Verify Discovery endpoint
      const discoveryLabel = detailsSection.locator('label:has-text("Discovery endpoint")');
      const discoveryEndpoint = await discoveryLabel.evaluate((el) => {
        const nextSpan = el.nextElementSibling;
        return nextSpan?.tagName === 'SPAN' ? nextSpan.textContent : null;
      });
      if (!discoveryEndpoint?.includes('keycloak.test/realms/opnc/.well-known/openid-configuration')) {
        return false;
      }

      // Verify Backchannel Logout URL
      const backchannelLabel = detailsSection.locator('label:has-text("Backchannel Logout URL")');
      const backchannelLogoutUrl = await backchannelLabel.evaluate((el) => {
        const nextSpan = el.nextElementSibling;
        return nextSpan?.tagName === 'SPAN' ? nextSpan.textContent : null;
      });
      if (!backchannelLogoutUrl?.includes('nextcloud.test/apps/user_oidc/backchannel-logout/keycloak')) {
        return false;
      }

      // Verify Redirect URI
      const redirectLabel = detailsSection.locator('label:has-text("Redirect URI")');
      const redirectUri = await redirectLabel.evaluate((el) => {
        const nextSpan = el.nextElementSibling;
        return nextSpan?.tagName === 'SPAN' ? nextSpan.textContent : null;
      });
      if (!redirectUri?.includes('nextcloud.test/apps/user_oidc/code')) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click on Apps menu link from profile menu
   */
  async clickAppsMenu(): Promise<void> {
    await this.getLocator('appsMenu').waitFor({ state: 'visible', timeout: 10000 });
    await this.getLocator('appsMenu').click();
    // Wait for navigation to apps page
    await this.page.waitForURL(/.*\/settings\/apps.*/, { timeout: 10000 });
    await this.page.waitForTimeout(1000);
  }

  /**
   * Click on Active Apps link
   */
  async clickActiveApps(): Promise<void> {
    await this.getLocator('activeAppsLink').waitFor({ state: 'visible', timeout: 10000 });
    await this.getLocator('activeAppsLink').click();
    // Wait for navigation to active apps page
    await this.page.waitForURL(/.*\/settings\/apps\/enabled.*/, { timeout: 10000 });
    await this.page.waitForTimeout(1000);
  }

  /**
   * Find OpenProject Integration app, scrolling if necessary
   */
  async findOpenProjectIntegrationApp(): Promise<void> {
    const appRow = this.getLocator('openProjectIntegrationAppRow');
    
    // Try to find the app without scrolling first
    try {
      await appRow.waitFor({ state: 'visible', timeout: 3000 });
      return;
    } catch {
      // If not visible, scroll to find it
      const appLink = this.getLocator('openProjectIntegrationAppLink');
      
      // Scroll until the app is visible
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        try {
          const isVisible = await appLink.isVisible({ timeout: 1000 }).catch(() => false);
          if (isVisible) {
            // Scroll the app into view
            await appLink.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(500);
            return;
          }
        } catch {
          // Continue scrolling
        }
        
        // Scroll down
        await this.page.evaluate(() => {
          window.scrollBy(0, 300);
        });
        await this.page.waitForTimeout(500);
        attempts++;
      }
      
      // Final attempt to wait for the element
      await appRow.waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  /**
   * Get OpenProject Integration app version
   */
  async getOpenProjectIntegrationAppVersion(): Promise<string> {
    await this.findOpenProjectIntegrationApp();
    const versionLocator = this.getLocator('openProjectIntegrationAppVersion');
    await versionLocator.waitFor({ state: 'visible', timeout: 10000 });
    const version = await versionLocator.textContent();
    return version?.trim() || '';
  }

  /**
   * Check if Disable button is present for OpenProject Integration app
   */
  async isDisableButtonPresentForOpenProjectIntegration(): Promise<boolean> {
    try {
      await this.findOpenProjectIntegrationApp();
      const disableButton = this.getLocator('openProjectIntegrationDisableButton');
      return await disableButton.isVisible({ timeout: 5000 }).catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Get the OpenProject Integration app link locator
   */
  getOpenProjectIntegrationAppLink() {
    return this.getLocator('openProjectIntegrationAppLink');
  }
}

