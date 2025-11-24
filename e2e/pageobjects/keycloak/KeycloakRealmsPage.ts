import { Page } from '@playwright/test';
import { KeycloakBasePage } from './KeycloakBasePage';
import { KeycloakClientsPage } from './KeycloakClientsPage';

export class KeycloakRealmsPage extends KeycloakBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/admin\/.*\/console\/#\/.*\/realms/, { timeout: 10000 });
    await this.getLocator('manageRealmsText').waitFor({ state: 'visible', timeout: 10000 });
  }

  async selectRealm(realmName: string): Promise<void> {
    const realmLink = this.page.locator(`a[href='#/${realmName}']`).filter({ hasText: realmName });
    await realmLink.waitFor({ state: 'visible', timeout: 10000 });
    await realmLink.click();
    await this.page.waitForTimeout(1000);
  }

  async verifyCurrentRealm(realmName: string): Promise<boolean> {
    try {
      const currentRealmLocator = this.getLocator('currentRealm');
      await currentRealmLocator.waitFor({ state: 'visible', timeout: 10000 });
      const text = await currentRealmLocator.textContent();
      return text?.trim() === realmName;
    } catch {
      return false;
    }
  }

  async clickClients(): Promise<KeycloakClientsPage> {
    await this.getLocator('clientsButton').click();
    await this.page.waitForURL(/.*\/admin\/.*\/console\/#\/.*\/clients/, { timeout: 10000 });
    return new KeycloakClientsPage(this.page);
  }
}

