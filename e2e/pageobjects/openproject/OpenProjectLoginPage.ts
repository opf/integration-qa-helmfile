import { Page } from '@playwright/test';
import { OpenProjectBasePage } from './OpenProjectBasePage';
import { KeycloakLoginPage } from '../keycloak/KeycloakLoginPage';
import { OpenProjectHomePage } from './OpenProjectHomePage';

export class OpenProjectLoginPage extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    // Wait for the page to be stable first
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    // Then wait for the sign in heading to be visible
    await this.getLocator('signInText').waitFor({ state: 'visible', timeout: 10000 });
  }

  async fillUsername(username: string): Promise<void> {
    await this.getLocator('usernameInput').fill(username);
  }

  async fillPassword(password: string): Promise<void> {
    await this.getLocator('passwordInput').fill(password);
  }

  async clickSignIn(): Promise<void> {
    await this.getLocator('loginButton').click();
  }

  async login(username: string = 'admin', password: string = 'admin'): Promise<OpenProjectHomePage> {
    await this.navigateTo();
    await this.waitForReady();
    // Wait for page to be stable before filling credentials
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(500); // Small delay to ensure page is fully loaded
    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.clickSignIn();
    await this.waitForOpenProjectUrl();
    return new OpenProjectHomePage(this.page);
  }

  async clickKeycloakAuthButton(): Promise<KeycloakLoginPage> {
    const keycloakButton = this.getLocator('keycloakAuthButton').first();
    await keycloakButton.waitFor({ state: 'attached', timeout: 10000 });
    
    const href = await keycloakButton.getAttribute('href');
    await this.page.goto(new URL(href!, this.page.url()).toString());
    await this.page.waitForURL(/.*keycloak\.test.*/, { timeout: 10000 });
    
    return new KeycloakLoginPage(this.page);
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      const loginForm = await this.getLocator('loginForm').count();
      if (loginForm === 0) {
        return true;
      }
      const userMenu = this.getLocator('userMenu').first();
      if (await userMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

