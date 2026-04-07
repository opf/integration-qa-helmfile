import { Page } from '@playwright/test';
import { KeycloakBasePage } from './KeycloakBasePage';
import { ADMIN_USER } from '../../utils/test-users';
import { testConfig } from '../../utils/config';
import { escapeForRegex, resolveHostname } from '../../utils/url-helpers';

const keycloakHost =
  resolveHostname(process.env.KEYCLOAK_URL) ||
  resolveHostname(process.env.KEYCLOAK_HOST) ||
  resolveHostname(testConfig.keycloak.host) ||
  'keycloak.test';
const keycloakHostPattern = new RegExp(`.*${escapeForRegex(keycloakHost)}.*`);

export class KeycloakLoginPage extends KeycloakBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    await super.navigateTo();
    await this.waitForReady();
  }

  async waitForReady(): Promise<void> {
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

  async login(username: string = ADMIN_USER.username, password: string = ADMIN_USER.password): Promise<void> {
    await this.navigateTo();
    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.clickSignIn();
    await this.page.waitForURL(/.*\/admin\/.*\/console.*/, { timeout: 10000 });
  }

  async loginAsUser(username: string, password: string): Promise<void> {
    await this.getLocator('usernameInput').waitFor({ state: 'visible', timeout: 10000 });
    await this.fillUsername(username);
    await this.fillPassword(password);
    
    const currentUrl = this.page.url();
    await this.clickSignIn();
    
    try {
      await this.page.waitForURL(
        (url) => !url.hostname.includes(keycloakHost),
        { timeout: 15000 }
      );
    } catch {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    }
  }
}

