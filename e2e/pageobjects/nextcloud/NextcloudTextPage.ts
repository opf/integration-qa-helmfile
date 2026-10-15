import { Page, expect } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudFilesPage } from './NextcloudFilesPage';
import { logInfo } from '../../utils/logger';

/** Nextcloud Text editor + OpenProject smart picker / rich reference card. */
export class NextcloudTextPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async openMarkdownFile(fileName: string): Promise<void> {
    const filesPage = new NextcloudFilesPage(this.page);
    await filesPage.navigateToFiles();
    await filesPage.waitForReady();

    const row = filesPage.getFileRow(fileName);
    await row.scrollIntoViewIfNeeded();
    await row.waitFor({ state: 'visible', timeout: 20000 });
    // Prefer the name-link button to avoid dblclick landing on the wrong row.
    const nameLink = row.getByRole('button', { name: new RegExp(fileName.replace(/\./g, '\\.'), 'i') }).first();
    if (await nameLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameLink.dblclick();
    } else {
      await row.dblclick();
    }
    await this.waitForEditor();
    await expect(this.getLocator('textViewerFileName').first()).toContainText(fileName, {
      timeout: 20000,
    });
    logInfo('Opened Nextcloud Text document %s', fileName);
  }

  async waitForEditor(timeoutMs = 30000): Promise<void> {
    // Wait out the viewer loading spinner before interacting with ProseMirror.
    await this.page
      .locator('#viewer.icon-loading, .viewer.icon-loading')
      .first()
      .waitFor({ state: 'hidden', timeout: timeoutMs })
      .catch(() => undefined);
    await this.getLocator('textEditorContent')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
  }

  async triggerSmartPicker(): Promise<void> {
    const editor = this.getLocator('textEditorContent').first();
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    await editor.click({ force: true });
    await this.page.keyboard.press('End');
    await this.page.keyboard.press('Enter');
    await this.page.keyboard.type('/', { delay: 50 });
    await this.getLocator('smartPickerSlashMenu')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  async selectOpenProjectProvider(): Promise<void> {
    const provider = this.getLocator('smartPickerOpenProjectProvider').first();
    await provider.waitFor({ state: 'visible', timeout: 15000 });
    await provider.click();
    await this.getLocator('smartPickerSearchInput')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  }

  async searchWorkPackage(query: string): Promise<void> {
    const modal = this.getLocator('smartPickerModal').first();
    await modal.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    const input = this.getLocator('smartPickerSearchInput').first();
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.click();
    await input.fill('');
    await input.type(query, { delay: 50 });
    await this.page.waitForTimeout(2000);
    await this.getLocator('smartPickerResultItem')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
  }

  async selectFirstWorkPackageResult(): Promise<void> {
    const result = this.getLocator('smartPickerResultItem').first();
    await result.waitFor({ state: 'visible', timeout: 20000 });
    await result.click();
  }

  async searchAndSelectWorkPackage(query: string): Promise<void> {
    await this.searchWorkPackage(query);
    await this.selectFirstWorkPackageResult();
  }

  async verifyReferenceCardInserted(timeoutMs = 20000): Promise<void> {
    await expect(this.getLocator('smartPickerReferenceCard').first()).toBeVisible({
      timeout: timeoutMs,
    });
    logInfo('OpenProject rich reference card inserted in Text editor');
  }
}
