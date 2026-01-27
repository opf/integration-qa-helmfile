import { Page } from '@playwright/test';
import { OpenProjectBasePage } from './OpenProjectBasePage';
import { KeycloakLoginPage } from '../keycloak/KeycloakLoginPage';
import { OpenProjectHomePage } from './OpenProjectHomePage';
import { OP_ADMIN_USER } from '../../utils/test-users';
import { testConfig } from '../../utils/config';

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveHostname = (value?: string): string => {
  if (!value) return '';
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
};

const keycloakHost = resolveHostname(process.env.KEYCLOAK_URL) || resolveHostname(testConfig.keycloak.host) || 'keycloak.test';
const keycloakHostPattern = new RegExp(`.*${escapeForRegex(keycloakHost)}.*`);

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

  async login(username: string = OP_ADMIN_USER.username, password: string = OP_ADMIN_USER.password): Promise<OpenProjectHomePage> {
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
    // If we've already been redirected to Keycloak (e.g., auto-SSO), skip looking for the OP button.
    if (keycloakHostPattern.test(this.page.url())) {
      const keycloakPage = new KeycloakLoginPage(this.page);
      await keycloakPage.waitForReady().catch(() => {});
      return keycloakPage;
    }

    // Try the known locator first, but fall back to a direct /auth/keycloak visit
    const primary = this.getLocator('keycloakAuthButton').first();
    const fallbackLocator = this.page.locator(
      "a[href*='/auth/keycloak'], button.auth-provider-keycloak, a.auth-provider-keycloak, button:has-text('Keycloak'), a:has-text('Keycloak')"
    ).first();

    const candidate = await Promise.race([
      primary.waitFor({ state: 'attached', timeout: 10000 }).then(() => primary).catch(() => null),
      fallbackLocator.waitFor({ state: 'attached', timeout: 10000 }).then(() => fallbackLocator).catch(() => null),
    ]);

    if (candidate) {
      const href = await candidate.getAttribute('href');
      if (href) {
        await this.page.goto(new URL(href, this.page.url()).toString());
      } else {
        await candidate.click({ timeout: 5000 });
      }
    } else {
      const keycloakUrl = new URL('/auth/keycloak', this.page.url()).toString();
      await this.page.goto(keycloakUrl);
    }

    await this.page.waitForURL(keycloakHostPattern, { timeout: 10000 });
    
    const keycloakPage = new KeycloakLoginPage(this.page);
    await keycloakPage.waitForReady().catch(() => {});
    return keycloakPage;
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

