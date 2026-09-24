import type { Locator, Page } from '@playwright/test';
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
        await this.waitForDemoProjectWorkPackageFilesUrl(15000).catch(() => undefined);
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
    await Promise.all([
      this.waitForDemoProjectWorkPackageFilesUrl(timeout),
      filesTab.click(),
    ]);
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
}
