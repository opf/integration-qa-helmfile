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

  /**
   * Check if a realm is currently selected by looking for the "Current realm" badge
   * Based on HTML structure: <td><div>opnc <span class="pf-v5-c-badge">Current realm</span></div></td>
   */
  async isRealmSelected(realmName: string): Promise<boolean> {
    try {
      // Wait a bit for the page to be ready
      await this.page.waitForTimeout(1000);
      
      // Look for a table cell (td) that contains the realm name
      // The structure is: <td><div>realmName <span class="pf-v5-c-badge">Current realm</span></div></td>
      // Try to find the cell that contains both the realm name and the badge
      const realmCell = this.page.locator('td.pf-v5-c-table__td').filter({ 
        hasText: realmName 
      });
      
      // Wait a bit for the table to be visible
      const cellCount = await realmCell.count();
      if (cellCount === 0) {
        logDebug('[REALM CHECK] Realm "%s" cell not found', realmName);
        return false;
      }
      
      // Check if the "Current realm" badge is present in this cell
      // Look for span with class pf-v5-c-badge containing "Current realm" text
      const currentRealmBadge = realmCell.locator('span.pf-v5-c-badge.pf-m-read:has-text("Current realm")');
      const badgeCount = await currentRealmBadge.count();
      const isSelected = badgeCount > 0;
      logDebug('[REALM CHECK] Realm "%s" is %s', realmName, isSelected ? 'already selected' : 'not selected');
      return isSelected;
    } catch (error: unknown) {
      logDebug('[REALM CHECK] Could not determine if realm "%s" is selected, assuming not. Error:', realmName, getErrorMessage(error));
      return false;
    }
  }

  async selectRealm(realmName: string): Promise<void> {
    logDebug('[REALM SELECTION] Selecting realm: %s', realmName);
    const realmLink = this.page.locator(`a[href='#/${realmName}']`).filter({ hasText: realmName });
    await realmLink.waitFor({ state: 'visible', timeout: 10000 });
    logDebug('[REALM SELECTION] Realm link found, clicking...');
    await realmLink.click();
    await this.page.waitForTimeout(3000);
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
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

