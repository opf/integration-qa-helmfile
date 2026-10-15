import { expect, Locator, Page } from '@playwright/test';
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
    } else {
      // Narrow viewports put the action under the selection Actions menu.
      const actions = this.getLocator('filesSelectionActionsButton').first();
      await actions.waitFor({ state: 'visible', timeout: 10000 });
      await actions.click();
      const menuItem = this.getLocator('filesLinkToWorkPackageButton').first();
      await menuItem.waitFor({ state: 'visible', timeout: 10000 });
      await menuItem.click();
    }
    await this.getLocator('filesLinkToWorkPackageModalHeading')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
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
    // NC 34+ stores the name on data-cy-files-list-row-name (data-cy-files-list-row is empty).
    return this.page
      .locator(`tr[data-cy-files-list-row-name="${fileName}"]`)
      .or(this.page.locator(`tr[data-file="${fileName}"]`))
      .or(this.page.getByRole('row', { name: new RegExp(this.escapeRegExp(fileName), 'i') }))
      .first();
  }

  private fileSelectCheckbox(fileName: string): Locator {
    const name = this.escapeRegExp(fileName);
    return this.getFileRow(fileName)
      .getByRole('checkbox', {
        name: new RegExp(`Toggle selection for (file|folder) ["']?${name}["']?`, 'i'),
      })
      .or(this.getFileRow(fileName).locator('input[type="checkbox"]'))
      .first();
  }

  private async waitForSelectionCount(minCount = 1): Promise<void> {
    const label = this.getLocator('filesSelectionCountLabel').first();
    await label.waitFor({ state: 'visible', timeout: 15000 });
    await expect
      .poll(async () => {
        const text = (await label.innerText().catch(() => '')).replace(/\s+/g, ' ');
        const match = text.match(/(\d+)\s+selected/i);
        return match ? parseInt(match[1], 10) : 0;
      }, { timeout: 10000 })
      .toBeGreaterThanOrEqual(minCount);
  }

  async selectFile(fileName: string): Promise<void> {
    const checkbox = this.fileSelectCheckbox(fileName);
    await checkbox.waitFor({ state: 'visible', timeout: 15000 });
    await checkbox.click({ force: true });
    await this.waitForSelectionCount(1);
  }

  async selectMultipleFiles(fileNames: string[]): Promise<void> {
    for (const name of fileNames) {
      const checkbox = this.fileSelectCheckbox(name);
      await checkbox.waitFor({ state: 'visible', timeout: 15000 });
      if (!(await checkbox.isChecked().catch(() => false))) {
        await checkbox.click({ force: true });
      }
    }
    await this.waitForSelectionCount(fileNames.length);
  }

  async openFileDetailsSidebar(fileName: string): Promise<void> {
    const row = this.getFileRow(fileName);
    await row.waitFor({ state: 'visible', timeout: 15000 });

    // NC 34: row Actions menu → OpenProject (or Details) opens the right sidebar.
    const actionsBtn = row.getByRole('button', { name: 'Actions', exact: true }).first();
    await actionsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await actionsBtn.click();

    const opMenuItem = this.getLocator('filesListRowOpenProjectMenuItem').first();
    if (await opMenuItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await opMenuItem.click();
      await this.getLocator('filesSidebarOpenProjectView')
        .first()
        .waitFor({ state: 'visible', timeout: 15000 });
      return;
    }

    const detailsItem = this.getLocator('filesListRowDetailsMenuItem').first();
    await detailsItem.waitFor({ state: 'visible', timeout: 5000 });
    await detailsItem.click();
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

  private getCssLocatorValue(locatorKey: string): string {
    const descriptor = this.locators.selectors[locatorKey];
    if (!descriptor || descriptor.by !== 'locator') {
      throw new Error(`Locator '${locatorKey}' must be a CSS locator`);
    }
    return descriptor.value;
  }

  /** Linked WP card in the NC OpenProject sidebar, matched by id (#N) or subject text. */
  getLinkedWorkPackageItem(match: string | number): Locator {
    const text = typeof match === 'number' ? `#${match}` : String(match);
    return this.getLocator('filesSidebarLinkedItem').filter({ hasText: text }).first();
  }

  async clickUnlinkWorkPackage(match: string | number): Promise<void> {
    const item = this.getLinkedWorkPackageItem(match);
    await item.waitFor({ state: 'visible', timeout: 15000 });
    await item.hover();
    const unlinkBtn = item.locator(this.getCssLocatorValue('filesSidebarUnlinkButton')).first();
    // NC 34: unlink is icon-only and stays aria-hidden until hover; force-click after hover.
    await unlinkBtn.waitFor({ state: 'attached', timeout: 10000 });
    await unlinkBtn.click({ force: true });
  }

  async confirmUnlinkIfPrompted(): Promise<void> {
    // NC uses OcDialog (.modal-wrapper), not always role=dialog.
    const dialog = this.getLocator('filesSidebarUnlinkConfirmDialog').first();
    if (!(await dialog.isVisible({ timeout: 3000 }).catch(() => false))) {
      return;
    }
    const unlinkBtn = dialog.getByRole('button', { name: 'Unlink', exact: true });
    await unlinkBtn.waitFor({ state: 'visible', timeout: 5000 });
    await unlinkBtn.click();
  }

  async expectLinkedWorkPackageHidden(match: string | number): Promise<void> {
    await this.getLinkedWorkPackageItem(match).waitFor({ state: 'hidden', timeout: 15000 });
  }

  /**
   * Resolve the numeric WP id from a linked sidebar card.
   * Prefers the element id (`workpackage-N`), falls back to `#N` in text content.
   */
  async getLinkedWorkPackageId(matchText: string): Promise<number> {
    const item = this.getLinkedWorkPackageItem(matchText);
    await item.waitFor({ state: 'visible', timeout: 20000 });

    const idAttr = await item.getAttribute('id');
    const fromAttr = idAttr?.match(/^workpackage-(\d+)$/);
    if (fromAttr) {
      return parseInt(fromAttr[1], 10);
    }

    const itemText = await item.textContent();
    const fromText = itemText?.match(/#(\d+)/);
    if (fromText) {
      return parseInt(fromText[1], 10);
    }

    throw new Error(
      `Could not extract work package ID from linked item (id=${idAttr ?? 'null'}, text=${itemText ?? 'null'})`,
    );
  }

  async unlinkWorkPackageFromSidebar(wpId: string | number): Promise<void> {
    await this.clickUnlinkWorkPackage(wpId);
    await this.confirmUnlinkIfPrompted();
    await this.expectLinkedWorkPackageHidden(wpId);
  }

  async hasLinkedWorkPackage(wpId: string | number): Promise<boolean> {
    return this.getLinkedWorkPackageItem(wpId).isVisible({ timeout: 5000 }).catch(() => false);
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

  /**
   * Fill a vue-select input and pick a matching option when the dropdown opens.
   * If the value is already committed (no options appear), press Enter to settle.
   */
  private async fillVueSelectOption(
    inputKey: string,
    optionsKey: string,
    value: string,
  ): Promise<void> {
    const input = this.getLocator(inputKey).first();
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.click();
    await input.fill(value);
    const option = this.getLocator(optionsKey).filter({ hasText: value }).first();
    if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
      await option.click();
      return;
    }
    await input.press('Enter');
  }

  async createWorkPackageFromModal(data: {
    project?: string;
    subject: string;
    type?: string;
    status?: string;
    description?: string;
  }): Promise<void> {
    const modal = this.getLocator('createWorkPackageModal').first();
    await modal.waitFor({ state: 'visible', timeout: 15000 });

    if (data.project) {
      await this.fillVueSelectOption(
        'createWorkPackageProjectInput',
        'createWorkPackageProjectOptions',
        data.project,
      );
    }

    // Scope inputs to the modal — bare page locators collide with Files list chrome.
    const subjectInput = modal.locator('input.workpackage-subject, .create-workpackage-form--subject input').first();
    await subjectInput.waitFor({ state: 'visible', timeout: 10000 });
    await subjectInput.click();
    await subjectInput.fill(data.subject);
    await expect(subjectInput).toHaveValue(data.subject);

    if (data.type) {
      await this.fillVueSelectOption(
        'createWorkPackageTypeInput',
        'createWorkPackageTypeOptions',
        data.type,
      );
    }

    // NC integration modal may require Status even when callers omit it.
    const statusInput = modal.locator(this.getCssLocatorValue('createWorkPackageStatusInput')).first();
    if (await statusInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.fillVueSelectOption(
        'createWorkPackageStatusInput',
        'createWorkPackageStatusOptions',
        data.status ?? 'New',
      );
    }

    if (data.description) {
      const descInput = modal.locator('textarea.create-workpackage-form--description').first();
      if (await descInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await descInput.fill(data.description);
      }
    }

    // Class-scoped submit — getByRole('Create') also matches nc-create-wp-* filenames.
    const submitBtn = modal.locator('.create-workpackage-form--button--create').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await expect(submitBtn).toBeEnabled({ timeout: 10000 });
    await submitBtn.click();
    await modal.waitFor({ state: 'hidden', timeout: 20000 });
  }

  async linkWorkPackagesInBulkModal(wpSubjectOrId: string | number): Promise<void> {
    const query = String(wpSubjectOrId);
    const modal = this.getLocator('bulkLinkModal').first();
    await modal.waitFor({ state: 'visible', timeout: 15000 });
    const searchInput = this.getLocator('bulkLinkSearchInput').first();
    await searchInput.waitFor({ state: 'visible', timeout: 15000 });
    await searchInput.click();
    await searchInput.fill(query);
    // Prefer "#N" match so a bare id like "2" does not hit unrelated rows.
    const idPattern = /^\d+$/.test(query) ? new RegExp(`#${query}\\b`) : new RegExp(this.escapeRegExp(query), 'i');
    const option = this.getLocator('bulkLinkSearchResults').filter({ hasText: idPattern }).first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
  }

  async waitForBulkLinkSuccess(timeoutMs = 20000): Promise<void> {
    const success = this.getLocator('bulkLinkSuccessProgress').first();
    const failed = this.getLocator('bulkLinkFailedProgress').first();
    const modal = this.getLocator('bulkLinkModal').first();
    // Selecting a WP auto-links; success UI can flash briefly before the modal closes.
    await Promise.race([
      success.waitFor({ state: 'visible', timeout: timeoutMs }),
      modal.waitFor({ state: 'hidden', timeout: timeoutMs }),
    ]);
    if (await failed.isVisible().catch(() => false)) {
      throw new Error('Bulk link reported failure in the progress panel');
    }
    await modal.waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => undefined);
  }
}
