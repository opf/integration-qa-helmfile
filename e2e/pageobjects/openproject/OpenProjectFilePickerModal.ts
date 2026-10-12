import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logDebug } from '../../utils/logger';
import { OpenProjectBasePage } from './OpenProjectBasePage';

export class OpenProjectFilePickerModal extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  async openFilesPickerWithUpload(uploadFileName: string, buffer?: Buffer): Promise<void> {
    const uploadInput = this.getLocator('workPackageFilesUploadInput');
    await uploadInput.waitFor({ state: 'attached', timeout: 15000 });
    // Upload under the requested name; default payload is the shared fixture so suite-scoped
    // unique filenames do not require a new on-disk file per run.
    const fixturePath = resolve(process.cwd(), 'fixtures/op-to-nc-upload-test.md');
    await uploadInput.setInputFiles({
      name: uploadFileName,
      mimeType: 'text/markdown',
      buffer: buffer ?? readFileSync(fixturePath),
    });
    await this.getLocator('filesPickerModal').waitFor({ state: 'visible', timeout: 15000 });
  }

  async waitForFilesPickerReady(fixtureFileName: string, maxAttempts = 15): Promise<void> {
    const modal = this.getLocator('filesPickerModal');
    const noConnection = this.getLocator('filesPickerNoConnectionError');
    const confirmButton = this.getLocator('filesPickerConfirmButton');
    const cancelButton = this.getLocator('filesPickerCancelButton');

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await modal.waitFor({ state: 'visible', timeout: 15000 });

      if (await noConnection.isVisible({ timeout: 2000 }).catch(() => false)) {
        logDebug(
          `[OpenProject] Files picker shows No Nextcloud connection; retrying ` +
            `(${attempt + 1}/${maxAttempts})`,
        );
        if (await cancelButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cancelButton.click();
        } else {
          await this.page.keyboard.press('Escape');
        }
        await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
        if (attempt < maxAttempts - 1) {
          await this.page.waitForTimeout(5000);
          await this.openFilesPickerWithUpload(fixtureFileName);
        }
        continue;
      }

      await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
      if (await confirmButton.isEnabled()) {
        return;
      }

      await this.page.waitForTimeout(5000);
    }

    await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
    if (!(await confirmButton.isEnabled())) {
      throw new Error('Files picker "Choose location" button did not become enabled.');
    }
  }

  /** Confirm location; if a name-collision modal appears, click Replace (2068 / seed path). */
  async confirmFilesPickerOptionalReplace(): Promise<void> {
    await this.getLocator('filesPickerConfirmButton').click();
    const existingFileModalTitle = this.getLocator('existingFileModalTitle');
    if (await existingFileModalTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await this.chooseFileCollisionAction('replace');
    }
  }

  /**
   * Confirm files-picker location and require the name-collision modal.
   * Fails fast if the upload succeeds without collision.
   */
  async confirmFilesPickerExpectingCollision(timeoutMs = 20000): Promise<void> {
    const confirmButton = this.getLocator('filesPickerConfirmButton');
    const collisionModal = this.getLocator('existingFileModalTitle');
    const uploadSuccess = this.getLocator('filesUploadSuccessMessage');

    await confirmButton.click();

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await collisionModal.isVisible().catch(() => false)) {
        return;
      }
      if (await uploadSuccess.isVisible().catch(() => false)) {
        throw new Error(
          'Expected "This file already exists" collision modal, but upload completed without collision.'
        );
      }
      await this.page.waitForTimeout(250);
    }

    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for collision modal (upload success toast also absent).`
    );
  }

  async chooseFileCollisionAction(action: 'replace' | 'keepBoth'): Promise<void> {
    await this.getLocator('existingFileModal').waitFor({ state: 'visible', timeout: 10000 });
    const key = action === 'replace' ? 'fileExistsReplaceButton' : 'fileExistsKeepBothButton';
    await this.getLocator(key).click();
  }

  /** UI seed: upload via AMPF, Replace on collision if needed, wait until linked. */
  async seedAmpfUpload(fileName: string, buffer?: Buffer): Promise<void> {
    await this.openFilesPickerWithUpload(fileName, buffer);
    await this.waitForFilesPickerReady(fileName);
    await this.confirmFilesPickerOptionalReplace();
    const uploadSuccessMessage = this.getLocator('filesUploadSuccessMessage');
    await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
    const linkedFileItem = this.getLocator('workPackageLinkedFileItem').filter({ hasText: fileName }).first();
    await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });
  }

  /** Open the link-existing files picker (not the upload location picker). */
  async openLinkExistingFilesPicker(): Promise<void> {
    const linkButton = this.getLocator('linkExistingFilesButton');
    await linkButton.waitFor({ state: 'visible', timeout: 15000 });
    await linkButton.click();
    await this.getLocator('filesPickerModal').waitFor({ state: 'visible', timeout: 15000 });
  }

  /** Wait until the link picker list is loaded (no connection error / loading spinner). */
  async waitForLinkPickerReady(maxAttempts = 15): Promise<void> {
    const modal = this.getLocator('filesPickerModal');
    const noConnection = this.getLocator('filesPickerNoConnectionError');
    const cancelButton = this.getLocator('filesPickerCancelButton');
    const fileList = this.getLocator('filesPickerFileList');
    const loading = this.getLocator('filesPickerLoadingIndicator');

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await modal.waitFor({ state: 'visible', timeout: 15000 });

      if (await noConnection.isVisible({ timeout: 2000 }).catch(() => false)) {
        logDebug(
          `[OpenProject] Link picker shows No Nextcloud connection; retrying ` +
            `(${attempt + 1}/${maxAttempts})`,
        );
        if (await cancelButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cancelButton.click();
        } else {
          await this.page.keyboard.press('Escape');
        }
        await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
        if (attempt < maxAttempts - 1) {
          await this.page.waitForTimeout(5000);
          await this.openLinkExistingFilesPicker();
        }
        continue;
      }

      if (await loading.isVisible({ timeout: 500 }).catch(() => false)) {
        await loading.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
      }

      if (await fileList.isVisible({ timeout: 3000 }).catch(() => false)) {
        return;
      }

      await this.page.waitForTimeout(2000);
    }

    await fileList.waitFor({ state: 'visible', timeout: 10000 });
  }

  /** Enter a folder row by clicking its caret (preferred OpenProject picker navigation). */
  async navigateIntoFolder(folderName: string): Promise<void> {
    const row = this.getLocator('filesPickerListItem').filter({ hasText: folderName }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    const caret = row.locator(this.getCssLocatorValue('filesPickerListItemCaret')).first();
    await caret.waitFor({ state: 'visible', timeout: 10000 });
    await caret.click();

    const loading = this.getLocator('filesPickerLoadingIndicator');
    if (await loading.isVisible({ timeout: 500 }).catch(() => false)) {
      await loading.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
    }

    const breadcrumb = this.getLocator('filesPickerBreadcrumb').filter({ hasText: folderName }).first();
    await breadcrumb.waitFor({ state: 'visible', timeout: 15000 });
  }

  /**
   * When AMPF projectFolder is not registered, the picker opens at the user home listing
   * (Documents, OpenProject, …). Walk OpenProject → {projectFolder} to match SSO AMPF root.
   * No-op when already inside the managed project folder.
   */
  async ensureAtAmpfProjectFolder(projectFolder: string): Promise<void> {
    const teamFolder = this.getLocator('filesPickerListItem')
      .filter({ hasText: /^OpenProject$/ })
      .first();
    if (!(await teamFolder.isVisible({ timeout: 3000 }).catch(() => false))) {
      return;
    }
    await this.navigateIntoFolder('OpenProject');
    const projectRow = this.getLocator('filesPickerListItem')
      .filter({ hasText: projectFolder })
      .first();
    if (await projectRow.isVisible({ timeout: 10000 }).catch(() => false)) {
      await this.navigateIntoFolder(projectFolder);
    }
  }

  /** Toggle selection of a file row in the link picker. */
  async selectFileInPicker(fileName: string): Promise<void> {
    const item = this.getLocator('filesPickerListItem').filter({ hasText: fileName }).first();
    await item.waitFor({ state: 'visible', timeout: 15000 });
    await item.click();
  }

  /** Confirm linking the selected file(s). */
  async confirmLinkSelection(timeoutMs = 10000): Promise<void> {
    const confirmButton = this.getLocator('filesPickerConfirmButton');
    await confirmButton.waitFor({ state: 'visible', timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await confirmButton.isEnabled()) {
        await confirmButton.click();
        return;
      }
      await this.page.waitForTimeout(250);
    }
    throw new Error('Files picker confirm button did not become enabled (select a file first).');
  }

  private getCssLocatorValue(locatorKey: string): string {
    const descriptor = this.locators.selectors[locatorKey];
    if (!descriptor || descriptor.by !== 'locator') {
      throw new Error(`Locator '${locatorKey}' must be a CSS locator`);
    }
    return descriptor.value;
  }
}
