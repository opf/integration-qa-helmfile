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
}
