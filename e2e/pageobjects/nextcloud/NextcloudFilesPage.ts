import { Locator, Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';

/** Nextcloud Files app — OpenProject folder + Link to work package flows. */
export class NextcloudFilesPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateToFiles(): Promise<void> {
    await this.page.goto(`${this.baseUrl}/index.php/apps/files/files`, {
      waitUntil: 'domcontentloaded',
    });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/\/apps\/files/, { timeout: 20000 });
    await this.getLocator('userMenu').first().waitFor({ state: 'visible', timeout: 20000 });
    await this.getLocator('filesListTable')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => undefined);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private folderOpenButton(folderName: string): Locator {
    const name = this.escapeRegExp(folderName);
    return this.page.getByRole('button', {
      name: new RegExp(`Open folder ${name}`, 'i'),
    });
  }

  private folderSelectCheckbox(folderName: string): Locator {
    const name = this.escapeRegExp(folderName);
    return this.page.getByRole('checkbox', {
      name: new RegExp(`Toggle selection for folder ["']${name}["']`, 'i'),
    });
  }

  async openFolder(folderName: string): Promise<void> {
    const openBtn = this.folderOpenButton(folderName);
    if (!(await openBtn.first().isVisible({ timeout: 5000 }).catch(() => false))) {
      // AMPF root often lives under Team folders until mounted in All files.
      const teamFolders = this.getLocator('filesTeamFoldersNavLink').first();
      if (await teamFolders.isVisible({ timeout: 3000 }).catch(() => false)) {
        await teamFolders.click();
        await this.waitForReady();
      }
    }
    await openBtn.first().waitFor({ state: 'visible', timeout: 20000 });
    await openBtn.first().click();
    await this.page.waitForTimeout(500);
  }

  async selectFolder(folderName: string): Promise<void> {
    const checkbox = this.folderSelectCheckbox(folderName).first();
    await checkbox.waitFor({ state: 'visible', timeout: 20000 });
    // NC Vue checkbox input is covered by .checkbox-content label span.
    await checkbox.click({ force: true });
    await this.getLocator('filesSelectionCountLabel')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickLinkToWorkPackage(): Promise<void> {
    const toolbar = this.getLocator('filesLinkToWorkPackageToolbarButton').first();
    if (await toolbar.isVisible({ timeout: 2000 }).catch(() => false)) {
      await toolbar.click();
      return;
    }
    // Narrow viewports put the action under the selection Actions menu.
    const actions = this.getLocator('filesSelectionActionsButton').first();
    await actions.waitFor({ state: 'visible', timeout: 10000 });
    await actions.click();
    const menuItem = this.getLocator('filesLinkToWorkPackageButton').first();
    await menuItem.waitFor({ state: 'visible', timeout: 10000 });
    await menuItem.click();
  }

  getNoConnectionModalHeadingLocator(): Locator {
    return this.getLocator('filesLinkToWorkPackageModalHeading').first();
  }

  getNoConnectionTextLocator(): Locator {
    return this.getLocator('filesNoConnectionWithOpenProjectText').first();
  }

  getModalConnectButtonLocator(): Locator {
    return this.getLocator('filesModalConnectToOpenProjectButton').first();
  }

  async waitForNoConnectionModal(timeoutMs = 20000): Promise<void> {
    // NC dialog often lacks aria-label; assert heading + body + CTA instead.
    await this.getNoConnectionModalHeadingLocator().waitFor({
      state: 'visible',
      timeout: timeoutMs,
    });
    await this.getNoConnectionTextLocator().waitFor({ state: 'visible', timeout: timeoutMs });
    await this.getModalConnectButtonLocator().waitFor({ state: 'visible', timeout: timeoutMs });
  }
}
