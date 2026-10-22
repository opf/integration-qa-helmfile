import { Page } from '@playwright/test';
import { KeycloakBasePage } from './KeycloakBasePage';
import { KeycloakClientsPage } from './KeycloakClientsPage';
import { getErrorMessage } from '../../utils/error-utils';
import { logDebug, logWarn } from '../../utils/logger';

export class KeycloakRealmsPage extends KeycloakBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/admin\/.*\/console\/#\/.*\/realms/, { timeout: 10000 });
    // Use the view-header test id instead of text to avoid strict mode violation
    // (there are two elements with "Manage realms" text: nav link and h1 header)
    await this.page.getByTestId('view-header').filter({ hasText: 'Manage realms' }).waitFor({ state: 'visible', timeout: 10000 });
  }

  /** True when Admin Console hash is this realm (welcome or nested path). */
  private isRealmInUrl(realmName: string): boolean {
    const hash = new URL(this.page.url()).hash; // e.g. #/opnc or #/opnc/clients
    return new RegExp(`^#/${realmName}(/|$)`).test(hash);
  }

  /**
   * Whether the realm is the active Admin Console context.
   * Prefer URL / sidebar currentRealm — clicking a realm leaves Manage realms
   * for the Welcome page, so the table "Current realm" badge is unreliable.
   */
  async isRealmSelected(realmName: string): Promise<boolean> {
    try {
      if (this.isRealmInUrl(realmName)) {
        logDebug('[REALM CHECK] Realm "%s" selected (URL hash)', realmName);
        return true;
      }

      const currentRealmLocator = this.getLocator('currentRealm');
      if (await currentRealmLocator.isVisible().catch(() => false)) {
        const text = (await currentRealmLocator.textContent())?.trim();
        if (text === realmName) {
          logDebug('[REALM CHECK] Realm "%s" selected (sidebar currentRealm)', realmName);
          return true;
        }
      }

      // Optional: still on Manage realms — table badge if present.
      const realmCell = this.page.locator('td.pf-v5-c-table__td').filter({ hasText: realmName });
      const tableBadge = realmCell.locator(
        'span.pf-v5-c-badge.pf-m-read:has-text("Current realm")',
      );
      if ((await tableBadge.count()) > 0) {
        logDebug('[REALM CHECK] Realm "%s" selected (Manage realms table badge)', realmName);
        return true;
      }

      logDebug('[REALM CHECK] Realm "%s" is not selected', realmName);
      return false;
    } catch (error: unknown) {
      logDebug(
        '[REALM CHECK] Could not determine if realm "%s" is selected, assuming not. Error:',
        realmName,
        getErrorMessage(error),
      );
      return false;
    }
  }

  async selectRealm(realmName: string): Promise<void> {
    logDebug('[REALM SELECTION] Selecting realm: %s', realmName);
    const realmLink = this.page
      .locator(`a[href='#/${realmName}']`)
      .filter({ hasText: realmName });
    await realmLink.waitFor({ state: 'visible', timeout: 10000 });
    logDebug('[REALM SELECTION] Realm link found, clicking...');
    await realmLink.click();
    // Console navigates to Welcome to <realm> (#/opnc) — do not wait for Manage realms table.
    await this.page.waitForURL(
      (url) => new RegExp(`#/${realmName}(/|$)`).test(url.hash),
      { timeout: 15000 },
    );
    await this.getLocator('currentRealm')
      .filter({ hasText: new RegExp(`^\\s*${realmName}\\s*$`) })
      .waitFor({ state: 'visible', timeout: 10000 });
    logDebug('[REALM SELECTION] Realm selection completed');
  }

  /**
   * Smart realm selection: checks if the realm is already selected,
   * and only selects it if necessary
   */
  async ensureRealmSelected(realmName: string): Promise<void> {
    logDebug('[REALM SELECTION] Ensuring realm "%s" is selected...', realmName);
    const isSelected = await this.isRealmSelected(realmName);
    if (isSelected) {
      logDebug('[REALM SELECTION] Realm "%s" is already selected, skipping selection', realmName);
      return;
    }
    logDebug('[REALM SELECTION] Realm "%s" is not selected, selecting now...', realmName);
    await this.selectRealm(realmName);
    const verifySelected = await this.isRealmSelected(realmName);
    if (!verifySelected) {
      logWarn('[REALM SELECTION] Realm "%s" may not have been selected successfully', realmName);
    }
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

