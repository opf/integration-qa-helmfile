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

  getFileRow(fileName: string): Locator {
    return this.page
      .locator(`tr[data-file="${fileName}"]`)
      .or(this.page.locator(`[data-cy-files-list-row="${fileName}"]`))
      .or(this.page.getByRole('row', { name: new RegExp(this.escapeRegExp(fileName), 'i') }))
      .first();
  }

  private fileSelectCheckbox(fileName: string): Locator {
    const name = this.escapeRegExp(fileName);
    return this.page
      .getByRole('checkbox', {
        name: new RegExp(`Toggle selection for (file|folder) ["']?${name}["']?`, 'i'),
      })
      .or(this.getFileRow(fileName).locator('td.selection input[type="checkbox"], td.selection label'));
  }

  async selectFile(fileName: string): Promise<void> {
    const checkbox = this.fileSelectCheckbox(fileName).first();
    await checkbox.waitFor({ state: 'visible', timeout: 15000 });
    await checkbox.click({ force: true });
    await this.getLocator('filesSelectionCountLabel')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  async selectMultipleFiles(fileNames: string[]): Promise<void> {
    for (const name of fileNames) {
      const checkbox = this.fileSelectCheckbox(name).first();
      await checkbox.waitFor({ state: 'visible', timeout: 15000 });
      await checkbox.click({ force: true });
    }
    await this.getLocator('filesSelectionCountLabel')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  async openFileDetailsSidebar(fileName: string): Promise<void> {
    const row = this.getFileRow(fileName);
    await row.waitFor({ state: 'visible', timeout: 15000 });
    const rowDetailsBtn = row.locator('.fileActionsMenu, button[aria-label="Actions"]').first();

    if (await rowDetailsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await rowDetailsBtn.click();
      const opAction = this.page.locator('li[data-action="integration_openproject-single"], li:has-text("OpenProject")').first();
      if (await opAction.isVisible({ timeout: 2000 }).catch(() => false)) {
        await opAction.click();
        await this.getLocator('filesSidebarOpenProjectView').first().waitFor({ state: 'visible', timeout: 15000 });
        return;
      }
      await this.page.keyboard.press('Escape');
    }

    const rowLink = row.getByRole('link', { name: new RegExp(this.escapeRegExp(fileName), 'i') }).first();
    await rowLink.click();
    await this.page.waitForTimeout(500);
    await this.openSidebarOpenProjectTab();
  }

  async openSidebarOpenProjectTab(): Promise<void> {
    const tab = this.getLocator('filesSidebarOpenProjectTab').first();
    if (await tab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tab.click();
    }
    await this.getLocator('filesSidebarOpenProjectView')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
  }

  async linkWorkPackageFromSidebar(wpSubjectOrId: string | number): Promise<void> {
    const query = String(wpSubjectOrId);
    const searchInput = this.getLocator('filesSidebarSearchInput').first();
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await searchInput.fill(query);
    const option = this.getLocator('filesSidebarSearchResults')
      .filter({ hasText: query })
      .first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    const linkedItem = this.getLocator('filesSidebarLinkedWorkPackages').first();
    await linkedItem.waitFor({ state: 'visible', timeout: 15000 });
  }

  async unlinkWorkPackageFromSidebar(wpId: string | number): Promise<void> {
    const item = this.page.locator(`#workpackage-${wpId}, .linked-workpackages--workpackage:has-text("#${wpId}")`).first();
    await item.waitFor({ state: 'visible', timeout: 15000 });
    const unlinkBtn = item.locator('.linked-workpackages--workpackage--unlinkactionbutton, button').first();
    await unlinkBtn.waitFor({ state: 'visible', timeout: 10000 });
    await unlinkBtn.click();
    const confirmBtn = this.page.locator('button:has-text("Confirm"), button:has-text("Unlink")').first();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await item.waitFor({ state: 'hidden', timeout: 15000 });
  }

  async hasLinkedWorkPackage(wpId: string | number): Promise<boolean> {
    const item = this.page.locator(`#workpackage-${wpId}, .linked-workpackages--workpackage:has-text("#${wpId}")`).first();
    return item.isVisible({ timeout: 5000 }).catch(() => false);
  }

  async getLinkedWorkPackagesCount(): Promise<number> {
    return this.getLocator('filesSidebarLinkedItem').count();
  }

  async openCreateWorkPackageModal(): Promise<void> {
    const btn = this.getLocator('filesSidebarCreateWorkPackageButton').first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click();
    await this.getLocator('createWorkPackageModal').first().waitFor({ state: 'visible', timeout: 15000 });
  }

  async createWorkPackageFromModal(data: {
    project?: string;
    subject: string;
    type?: string;
    description?: string;
  }): Promise<void> {
    const modal = this.getLocator('createWorkPackageModal').first();
    await modal.waitFor({ state: 'visible', timeout: 15000 });

    if (data.project) {
      const projInput = this.getLocator('createWorkPackageProjectInput').first();
      await projInput.waitFor({ state: 'visible', timeout: 10000 });
      await projInput.fill(data.project);
      const projOption = this.getLocator('createWorkPackageProjectOptions').filter({ hasText: data.project }).first();
      await projOption.waitFor({ state: 'visible', timeout: 10000 });
      await projOption.click();
    }

    const subjectInput = this.getLocator('createWorkPackageSubjectInput').first();
    await subjectInput.waitFor({ state: 'visible', timeout: 10000 });
    await subjectInput.fill(data.subject);

    if (data.type) {
      const typeInput = this.getLocator('createWorkPackageTypeInput').first();
      await typeInput.waitFor({ state: 'visible', timeout: 10000 });
      await typeInput.fill(data.type);
      const typeOption = this.getLocator('createWorkPackageTypeOptions').filter({ hasText: data.type }).first();
      await typeOption.waitFor({ state: 'visible', timeout: 10000 });
      await typeOption.click();
    }

    if (data.description) {
      const descInput = this.getLocator('createWorkPackageDescriptionInput').first();
      if (await descInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await descInput.fill(data.description);
      }
    }

    const submitBtn = this.getLocator('createWorkPackageSubmitButton').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await submitBtn.click();
    await modal.waitFor({ state: 'hidden', timeout: 20000 });
  }

  async linkWorkPackagesInBulkModal(wpSubjectOrId: string | number): Promise<void> {
    const query = String(wpSubjectOrId);
    const searchInput = this.getLocator('bulkLinkSearchInput').first();
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await searchInput.fill(query);
    const option = this.getLocator('bulkLinkSearchResults').filter({ hasText: query }).first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
  }

  async waitForBulkLinkSuccess(timeoutMs = 20000): Promise<void> {
    await this.getLocator('bulkLinkSuccessProgress').first().waitFor({ state: 'visible', timeout: timeoutMs });
    await this.getLocator('bulkLinkModal').first().waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => undefined);
  }
}
