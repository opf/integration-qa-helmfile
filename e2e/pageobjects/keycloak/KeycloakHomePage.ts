import { Page } from '@playwright/test';
import { KeycloakBasePage } from './KeycloakBasePage';
import { KeycloakRealmsPage } from './KeycloakRealmsPage';
import { KeycloakClientsPage } from './KeycloakClientsPage';

export class KeycloakHomePage extends KeycloakBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.getLocator('welcomeText').waitFor({ state: 'visible', timeout: 10000 });
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      await this.page.waitForURL(/.*\/admin\/.*\/console.*/, { timeout: 5000 });
      await this.getLocator('manageRealmsButton').waitFor({ timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async navigateToHome(): Promise<void> {
    const url = this.page.url();
    const match = url.match(/https:\/\/[^\/]+\/admin\/([^\/]+)\/console/);
    if (match) {
      const realm = match[1];
      await this.page.goto(`${this.baseUrl}/admin/${realm}/console`, { waitUntil: 'domcontentloaded' });
      await this.waitForReady();
    }
  }

  async clickManageRealms(): Promise<KeycloakRealmsPage> {
    await this.getLocator('manageRealmsButton').click();
    await this.page.waitForURL(/.*\/admin\/.*\/console\/#\/.*\/realms/, { timeout: 10000 });
    return new KeycloakRealmsPage(this.page);
  }

  async clickClients(): Promise<KeycloakClientsPage> {
    await this.getLocator('clientsButton').click();
    await this.page.waitForURL(/.*\/admin\/.*\/console\/#\/.*\/clients/, { timeout: 10000 });
    return new KeycloakClientsPage(this.page);
  }
}

