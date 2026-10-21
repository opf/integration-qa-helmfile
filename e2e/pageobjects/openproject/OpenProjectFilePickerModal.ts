import { expect, type Page } from '@playwright/test';
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
    let attempt = 0;

    await expect
      .poll(
        async () => {
          attempt += 1;
          await modal.waitFor({ state: 'visible', timeout: 15000 });

          if (await noConnection.isVisible({ timeout: 2000 }).catch(() => false)) {
            logDebug(
              `[OpenProject] Files picker shows No Nextcloud connection; retrying ` +
                `(${attempt}/${maxAttempts})`,
            );
            if (await cancelButton.isVisible({ timeout: 1000 }).catch(() => false)) {
              await cancelButton.click();
            } else {
              await this.page.keyboard.press('Escape');
            }
            await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
            if (attempt < maxAttempts) {
              await this.openFilesPickerWithUpload(fixtureFileName);
            }
            return false;
          }

          await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
          return confirmButton.isEnabled();
        },
        { timeout: maxAttempts * 5000, intervals: [1000, 2000, 5000] },
      )
      .toBe(true);
  }

  /** Wait for Choose location after a multi-file `setInputFiles` (no re-upload on retry). */
  async waitForFilesPickerConfirmReady(maxAttempts = 15): Promise<void> {
    const modal = this.getLocator('filesPickerModal');
    const confirmButton = this.getLocator('filesPickerConfirmButton');

    await modal.waitFor({ state: 'visible', timeout: 15000 });
    await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
    await expect(confirmButton).toBeEnabled({ timeout: maxAttempts * 2000 });
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

    const outcome = await Promise.race([
      collisionModal.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => 'collision' as const),
      uploadSuccess.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => 'success' as const),
    ]).catch(() => null);

    if (outcome === 'collision') {
      return;
    }
    if (outcome === 'success') {
      throw new Error(
        'Expected "This file already exists" collision modal, but upload completed without collision.',
      );
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for collision modal (upload success toast also absent).`,
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
    let attempt = 0;

    await expect
      .poll(
        async () => {
          attempt += 1;
          await modal.waitFor({ state: 'visible', timeout: 15000 });

          if (await noConnection.isVisible({ timeout: 2000 }).catch(() => false)) {
            logDebug(
              `[OpenProject] Link picker shows No Nextcloud connection; retrying ` +
                `(${attempt}/${maxAttempts})`,
            );
            if (await cancelButton.isVisible({ timeout: 1000 }).catch(() => false)) {
              await cancelButton.click();
            } else {
              await this.page.keyboard.press('Escape');
            }
            await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
            if (attempt < maxAttempts) {
              await this.openLinkExistingFilesPicker();
            }
            return false;
          }

          if (await loading.isVisible({ timeout: 500 }).catch(() => false)) {
            await loading.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => undefined);
          }

          return fileList.isVisible({ timeout: 3000 }).catch(() => false);
        },
        { timeout: maxAttempts * 5000, intervals: [1000, 2000, 5000] },
      )
      .toBe(true);
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
    await expect(confirmButton).toBeEnabled({ timeout: timeoutMs });
    await confirmButton.click();
  }

  private getCssLocatorValue(locatorKey: string): string {
    const descriptor = this.locators.selectors[locatorKey];
    if (!descriptor || descriptor.by !== 'locator') {
      throw new Error(`Locator '${locatorKey}' must be a CSS locator`);
    }
    return descriptor.value;
  }
}
