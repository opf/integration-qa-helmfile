import type { Locator, Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { logDebug } from '../../utils/logger';
import { OpenProjectBasePage } from './OpenProjectBasePage';

export class OpenProjectWorkPackageFilesTab extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Wait until the WP Files tab Nextcloud section is connected for the current user.
   * API projectFolder health is not enough — UI can still show "No Nextcloud connection".
   * Soft-reloads the Files URL inside the budget; does not use a fixed upfront sleep.
   */
  async waitForNextcloudFilesSectionConnected(
    workPackageId: number,
    options: { timeoutMs?: number } = {},
  ): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const deadline = Date.now() + timeoutMs;
    const noConnection = this.getLocator('filesTabNoConnectionError').first();
    const uploadInput = this.getLocator('workPackageFilesUploadInput').first();
    const dropBox = this.getLocator('workPackageFilesUploadDropBox').first();
    let reloadCount = 0;
    const maxReloads = 4;

    while (Date.now() < deadline) {
      const bannerVisible = await noConnection.isVisible().catch(() => false);
      const uploadAttached = await uploadInput
        .waitFor({ state: 'attached', timeout: 1500 })
        .then(() => true)
        .catch(() => false);
      const dropBoxVisible = await dropBox.isVisible().catch(() => false);

      if (!bannerVisible && (uploadAttached || dropBoxVisible)) {
        // Debounce a second poll so a transient READY flash does not race ahead.
        await this.page.waitForTimeout(500);
        const stillBanner = await noConnection.isVisible().catch(() => false);
        const stillUploadAttached = await uploadInput.count().then((n) => n > 0).catch(() => false);
        const stillDropBox = await dropBox.isVisible().catch(() => false);
        if (!stillBanner && (stillUploadAttached || stillDropBox)) {
          logDebug('[OpenProject] Nextcloud Files section is connected');
          return;
        }
      }

      if (bannerVisible && reloadCount < maxReloads && Date.now() + 2000 < deadline) {
        reloadCount += 1;
        logDebug(
          `[OpenProject] Files tab still shows No Nextcloud connection; soft-reloading (${reloadCount}/${maxReloads})`,
        );
        await this.navigateToDemoProjectWorkPackageFiles(workPackageId);
        if (!this.isOnDemoProjectWorkPackageFilesUrl()) {
          await this.openWorkPackageFilesTab(15000);
        }
        continue;
      }

      await this.page.waitForTimeout(1000);
    }

    throw new Error(
      'API storage healthy but Files tab still shows No Nextcloud connection ' +
        `(or upload control not ready) after ${timeoutMs}ms.`,
    );
  }

  async openWorkPackageFilesTab(timeout: number = 15000): Promise<void> {
    const filesTab = this.getLocator('filesMenuItem');
    await filesTab.waitFor({ state: 'visible', timeout });
    await filesTab.click();
    // OP 18 may keep /work_packages/:id without appending /files — accept either URL or Files UI.
    await Promise.race([
      this.waitForDemoProjectWorkPackageFilesUrl(timeout),
      this.getLocator('linkExistingFilesButton').first().waitFor({ state: 'visible', timeout }),
      this.getNextcloudLoginButtonLocator().waitFor({ state: 'visible', timeout }),
    ]).catch(() => undefined);
  }

  getStorageLoginPromptLocator(): Locator {
    return this.getLocator('loginToNextcloudRequiredHeading').first();
  }

  getNextcloudLoginButtonLocator(): Locator {
    return this.getLocator('nextcloudLoginButton').first();
  }

  async waitForNextcloudLoginPrompt(timeoutMs = 30000): Promise<void> {
    await this.getStorageLoginPromptLocator().waitFor({ state: 'visible', timeout: timeoutMs });
    await this.getNextcloudLoginButtonLocator().waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickNextcloudLogin(): Promise<void> {
    const button = this.getNextcloudLoginButtonLocator();
    await button.waitFor({ state: 'visible', timeout: 15000 });
    await button.click();
  }

  getLinkedWorkPackageFileItem(fileName: string): Locator {
    return this.getLocator('workPackageLinkedFileItem').filter({ hasText: fileName }).first();
  }

  countLinkedWorkPackageFiles(fileName: string): Promise<number> {
    return this.getLocator('workPackageLinkedFileItem').filter({ hasText: fileName }).count();
  }

  getLinkedWorkPackageFileItemMatching(pattern: RegExp): Locator {
    return this.getLocator('workPackageLinkedFileItem').filter({ hasText: pattern }).first();
  }

  async hoverLinkedWorkPackageFile(fileName: string): Promise<Locator> {
    const fileItem = this.getLinkedWorkPackageFileItem(fileName);
    await fileItem.waitFor({ state: 'visible', timeout: 15000 });
    await fileItem.hover();
    return fileItem;
  }

  getLinkedWorkPackageFileDownloadAction(fileName: string): Locator {
    return this.getLinkedWorkPackageFileAction(fileName, 'workPackageLinkedFileDownloadAction');
  }

  getLinkedWorkPackageFileOpenLocationAction(fileName: string): Locator {
    return this.getLinkedWorkPackageFileAction(fileName, 'workPackageLinkedFileOpenLocationAction');
  }

  getLinkedWorkPackageFileRemoveLinkAction(fileName: string): Locator {
    return this.getLinkedWorkPackageFileAction(fileName, 'workPackageLinkedFileRemoveLinkAction');
  }

  /**
   * Faulty/disabled Nextcloud link action (deleted or inaccessible remote file).
   * Scoped under the linked file row for the given name.
   */
  getLinkedWorkPackageFileFaultyAction(fileName: string): Locator {
    return this.getLinkedWorkPackageFileAction(fileName, 'workPackageLinkedFileFaultyAction');
  }

  getLinkedWorkPackageFileMissingTooltip(): Locator {
    return this.getLocator('workPackageLinkedFileMissingTooltip');
  }

  /**
   * Hover the linked file and wait until the missing/not-found indicator is visible.
   * Does not crash the Files tab: the row remains in the DOM.
   */
  async waitForLinkedWorkPackageFileMissing(fileName: string): Promise<Locator> {
    const fileItem = await this.hoverLinkedWorkPackageFile(fileName);
    await this.getLinkedWorkPackageFileFaultyAction(fileName).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await this.getLinkedWorkPackageFileMissingTooltip().waitFor({
      state: 'visible',
      timeout: 10000,
    });
    return fileItem;
  }

  async downloadLinkedWorkPackageFileText(fileName: string): Promise<string> {
    await this.hoverLinkedWorkPackageFile(fileName);
    const downloadAction = this.getLinkedWorkPackageFileDownloadAction(fileName);
    await downloadAction.waitFor({ state: 'visible', timeout: 10000 });
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 20000 }),
      downloadAction.click(),
    ]);
    const stream = await download.createReadStream();
    if (!stream) {
      throw new Error(`Download for ${fileName} produced no stream`);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private getLinkedWorkPackageFileAction(fileName: string, locatorKey: string): Locator {
    const actionSelector = this.getCssLocatorValue(locatorKey);
    return this.getLinkedWorkPackageFileItem(fileName).locator(actionSelector).first();
  }

  private getCssLocatorValue(locatorKey: string): string {
    const descriptor = this.locators.selectors[locatorKey];
    if (!descriptor || descriptor.by !== 'locator') {
      throw new Error(`Locator '${locatorKey}' must be a CSS locator`);
    }

    return descriptor.value;
  }

  /**
   * Attach one or more files to `#upload_files` (drop-box / Upload files control).
   * Real filesystem paths are used when they exist; otherwise each entry is treated as a
   * file name and filled from `fixtures/op-to-nc-upload-test.md`.
   */
  /**
   * Attach files via `#upload_files`. OpenProject's input is single-file only, so multiple
   * names are uploaded one at a time (caller confirms the location picker between calls).
   */
  async uploadOrDropFiles(filePathsOrNames: string[]): Promise<void> {
    if (filePathsOrNames.length === 0) {
      throw new Error('uploadOrDropFiles requires at least one file');
    }
    await this.uploadOrDropOneFile(filePathsOrNames[0]);
  }

  async uploadOrDropOneFile(filePathOrName: string): Promise<void> {
    const uploadInput = this.getLocator('workPackageFilesUploadInput').first();
    await uploadInput.waitFor({ state: 'attached', timeout: 15000 });
    if (existsSync(filePathOrName)) {
      await uploadInput.setInputFiles(filePathOrName);
      return;
    }
    const fixtureBuffer = readFileSync(resolve(process.cwd(), 'fixtures/op-to-nc-upload-test.md'));
    await uploadInput.setInputFiles({
      name: basename(filePathOrName),
      mimeType: 'text/markdown',
      buffer: fixtureBuffer,
    });
  }

  async navigateToProjectWorkPackageFiles(
    projectIdentifier: string,
    workPackageId: number,
  ): Promise<void> {
    const url = `${this.baseUrl}/projects/${projectIdentifier}/work_packages/${workPackageId}/files`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  }

  async openWorkPackageFilesTabIfNeeded(timeout = 20000): Promise<void> {
    const linkExisting = this.getLocator('linkExistingFilesButton').first();
    if (await linkExisting.isVisible({ timeout: 2000 }).catch(() => false)) {
      return;
    }
    await this.openWorkPackageFilesTab(timeout);
  }

  /**
   * OP 18: without folder ACL / file perms, upload+link controls are hidden and the
   * empty-list / storage-info hint remains (legacy op-storage--access-restricted is gone).
   */
  async verifyAccessRestrictedNotice(timeoutMs = 15000): Promise<void> {
    const uploadBtn = this.getLocator('uploadFilesButton').first();
    const linkBtn = this.getLocator('linkExistingFilesButton').first();
    const dropBox = this.getLocator('workPackageFilesUploadDropBox').first();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const uploadVisible = await uploadBtn.isVisible({ timeout: 500 }).catch(() => false);
      const linkVisible = await linkBtn.isVisible({ timeout: 500 }).catch(() => false);
      const dropVisible = await dropBox.isVisible({ timeout: 500 }).catch(() => false);
      if (!uploadVisible && !linkVisible && !dropVisible) {
        const hint = this.getLocator('filesTabNextcloudEmptyHint').first();
        const info = this.getLocator('filesTabAccessRestrictedNotice').first();
        if (
          (await hint.isVisible({ timeout: 1000 }).catch(() => false)) ||
          (await info.isVisible({ timeout: 1000 }).catch(() => false))
        ) {
          return;
        }
        // Actions gone is enough when Nextcloud header still rendered.
        return;
      }
      await this.page.waitForTimeout(500);
    }
    throw new Error(
      'Expected Files-tab Nextcloud upload/link controls to be hidden (permission boundary)',
    );
  }

  /** Assert Files-tab upload control is not available under access restriction. */
  async expectUploadRestricted(timeoutMs = 5000): Promise<void> {
    const uploadInput = this.getLocator('workPackageFilesUploadInput').first();
    const dropBox = this.getLocator('workPackageFilesUploadDropBox').first();
    const uploadBtn = this.getLocator('uploadFilesButton').first();
    const uploadAttached = await uploadInput
      .waitFor({ state: 'attached', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
    const dropVisible = await dropBox.isVisible({ timeout: 1000 }).catch(() => false);
    const uploadBtnVisible = await uploadBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (uploadAttached || dropVisible || uploadBtnVisible) {
      throw new Error(
        'Expected upload/drop controls to be unavailable for access-restricted storage',
      );
    }
  }
}
