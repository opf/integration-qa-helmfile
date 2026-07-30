import type { Locator, Page, Response } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OpenProjectBasePage } from './OpenProjectBasePage';
import { logDebug, logWarn } from '../../utils/logger';
import { waitForProjectCreated } from '../../utils/openproject-api';

interface WaitForReadyOptions {
  /** When false, skip first-login language/tutorial dismissal (e.g. after an admin reload). */
  dismissOnboarding?: boolean;
}

export class OpenProjectHomePage extends OpenProjectBasePage {
  private static readonly FIRST_LOGIN_PROMPT_PASSES = 3;
  private firstTimeTourExpected = false;
  private responseListener?: (response: Response) => void;

  constructor(page: Page) {
    super(page);
  }

  async waitForReady(options: WaitForReadyOptions = {}): Promise<void> {
    const dismissOnboarding = options.dismissOnboarding !== false;

    await this.waitForOpenProjectUrl(15000);
    if (dismissOnboarding) {
      this.installFirstLoginSignalListeners();
      await this.dismissFirstLoginPromptsIfPresent();
      this.uninstallFirstLoginSignalListeners();
    }
    const userProfileButton = this.getLocator('userProfileButton').first();
    await userProfileButton.waitFor({ state: 'visible', timeout: 10000 });
  }

  private isFirstTimeUserUrl(): boolean {
    try {
      const url = new URL(this.page.url());
      return url.searchParams.get('first_time_user') === 'true';
    } catch {
      return false;
    }
  }

  private installFirstLoginSignalListeners(): void {
    if (this.responseListener) return;

    // If we're currently at /?first_time_user=true, remember it even if the SPA removes the query later.
    if (this.isFirstTimeUserUrl()) this.firstTimeTourExpected = true;

    const listener = (response: Response) => {
      const url = response.url();
      if (url.includes('first_time_user=true') || /onboarding_tour-[\w-]+\.js(\?|$)/.test(url)) {
        this.firstTimeTourExpected = true;
      }
    };

    this.page.on('response', listener);
    this.responseListener = listener;
  }

  private uninstallFirstLoginSignalListeners(): void {
    if (!this.responseListener) return;
    this.page.off('response', this.responseListener);
    this.responseListener = undefined;
  }

  private async closeUserMenuDialogIfOpen(): Promise<void> {
    const dialog = this.getLocator('userMenuDialog').first();
    const isVisible = await dialog.isVisible({ timeout: 200 }).catch(() => false);
    if (!isVisible) return;

    await this.page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => undefined);
  }

  private async dismissFirstLoginPromptsIfPresent(): Promise<void> {
    for (let attempt = 0; attempt < OpenProjectHomePage.FIRST_LOGIN_PROMPT_PASSES; attempt += 1) {
      const dismissedLanguageModal = await this.dismissLanguageSelectionModalIfPresent();
      if (dismissedLanguageModal) continue;

      const dismissedTutorialOverlay = await this.dismissTutorialOverlayIfPresent();
      if (dismissedTutorialOverlay) continue;

      break;
    }
  }

  async dismissLanguageSelectionModalIfPresent(): Promise<boolean> {
    const modal = this.getLocator('languageSelectionModal').first();

    const isVisible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVisible) return false;

    logDebug('[OpenProject] Language selection modal detected, saving default language');

    try {
      const saveButton = this.getLocator('languageSelectionSaveButton').first();
      await saveButton.waitFor({ state: 'visible', timeout: 5000 });
      await saveButton.click();
      await modal.waitFor({ state: 'hidden', timeout: 10000 });
      return true;
    } catch (error: unknown) {
      logWarn('[OpenProject] Failed to dismiss language selection modal', error);
      return false;
    }
  }

  async dismissTutorialOverlayIfPresent(): Promise<boolean> {
    const overlay = this.getLocator('tutorialOverlay').first();
    const overlayVisible = await overlay.isVisible({ timeout: 500 }).catch(() => false);
    const urlExpectsTour = this.isFirstTimeUserUrl();

    // Onboarding JS can load on repeat logins without showing the tour overlay.
    if (!overlayVisible && !urlExpectsTour) {
      this.firstTimeTourExpected = false;
      return false;
    }

    const skipButton = this.getLocator('tutorialSkipButton').first();
    const skipWaitTimeout = overlayVisible ? 10_000 : 5_000;

    try {
      await skipButton.waitFor({ state: 'visible', timeout: skipWaitTimeout });
    } catch {
      this.firstTimeTourExpected = false;
      return false;
    }

    logDebug('[OpenProject] Tutorial overlay detected, skipping it');
    await this.closeUserMenuDialogIfOpen();

    try {
      await skipButton.click();
      await skipButton.waitFor({ state: 'hidden', timeout: 10000 });
      this.firstTimeTourExpected = false;
      return true;
    } catch (error: unknown) {
      logWarn('[OpenProject] Failed to dismiss tutorial overlay', error);
      return false;
    }
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      const userProfileButton = this.getLocator('userProfileButton').first();
      await userProfileButton.waitFor({ state: 'visible', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async verifyUserProfileButton(expectedName: string): Promise<boolean> {
    try {
      // Tutorial / language prompts may appear late; dismiss right before interacting.
      await this.dismissFirstLoginPromptsIfPresent();

      const buttonSelectors = [
        'userProfileButton',
        'userProfileButtonAlt',
        'userProfileButtonAlt2',
        'userProfileButtonAlt3'
      ];
      
      let profileButton = null;
      for (const selectorKey of buttonSelectors) {
        try {
          const locator = this.getLocator(selectorKey).first();
          await locator.waitFor({ state: 'visible', timeout: 3000 });
          profileButton = locator;
          break;
        } catch {
          continue;
        }
      }
      
      if (!profileButton) {
        return false;
      }
      
      await profileButton.click();
      const userNameDiv = this.getLocator('userNameText').first();
      await userNameDiv.waitFor({ state: 'visible', timeout: 5000 });
      
      const userNameText = await userNameDiv.textContent();
      await this.closeUserMenuDialogIfOpen();
      
      if (userNameText && userNameText.trim() === expectedName) {
        return true;
      }
      
      if (userNameText && userNameText.trim().toLowerCase().includes(expectedName.toLowerCase())) {
        return true;
      }
      
      const dialog = this.getLocator('dialog').first();
      const dialogText = await dialog.textContent().catch(() => null);
      
      return dialogText?.includes(expectedName) ?? false;
    } catch {
      await this.closeUserMenuDialogIfOpen().catch(() => undefined);
      return false;
    }
  }

  async getUserNameFromProfile(): Promise<string> {
    // Tutorial / language prompts may appear late; dismiss right before interacting.
    await this.dismissFirstLoginPromptsIfPresent();
    await this.closeUserMenuDialogIfOpen();

    const profileButton = this.getLocator('userProfileButton').first();

    await profileButton.waitFor({ state: 'visible', timeout: 10000 });

    const opcePrincipal = profileButton.locator('opce-principal[data-test-selector="op-principal"]').first();

    const dataPrincipal = await opcePrincipal.getAttribute('data-principal');
    if (dataPrincipal) {
      try {
        const principal = JSON.parse(dataPrincipal);
        if (principal.name) return principal.name;
      } catch {
      }
    }

    const dataTitle = await opcePrincipal.getAttribute('data-title');
    if (dataTitle) return dataTitle.replace(/^["']|["']$/g, '');

    await Promise.all([
      profileButton.click(),
      this.getLocator('userNameInMenu').waitFor({ state: 'visible', timeout: 5000 })
    ]);

    const userName = await this.getLocator('userNameInMenu').first().textContent();
    const value = userName?.trim() || '';
    await this.closeUserMenuDialogIfOpen();
    return value;
  }

  async navigateToAllProjects(): Promise<void> {
    const viewAllProjectsButton = this.getLocator('viewAllProjectsButton').first();
    await viewAllProjectsButton.waitFor({ state: 'visible', timeout: 10000 });

    await Promise.all([
      this.page.waitForURL(/\/projects\/?$/, { timeout: 15000 }),
      viewAllProjectsButton.click(),
    ]);
  }

  /**
   * Copy the demo project via UI: waits for home, navigates to all projects, copies demo project to the given identifier.
   */
  async copyDemoProjectViaUi(newIdentifier: string): Promise<void> {
    await this.waitForReady();
    await this.navigateToAllProjects();
    await this.copyDemoProjectTo(newIdentifier);
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
    const linkedFileItem = this.getLinkedWorkPackageFileItem(fileName);
    await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });
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

  async copyDemoProjectTo(name: string): Promise<void> {
    const demoProjectKebabButton = this.getLocator('demoProjectKebabButton').first();
    await demoProjectKebabButton.waitFor({ state: 'visible', timeout: 15000 });
    await demoProjectKebabButton.click();

    const copyActionItem = this.getLocator('projectActionsCopyItem').first();
    await copyActionItem.waitFor({ state: 'visible', timeout: 15000 });

    await Promise.all([
      this.page.waitForURL(/\/projects\/demo-project\/copy\/?$/, { timeout: 15000 }),
      copyActionItem.click(),
    ]);

    const nameInput = this.getLocator('copyProjectNameInput').first();
    await nameInput.waitFor({ state: 'visible', timeout: 15000 });
    await nameInput.fill(name);

    const copyButton = this.getLocator('copyProjectSubmitButton').first();
    await copyButton.waitFor({ state: 'visible', timeout: 15000 });

    const targetUrlPattern = new RegExp(`/projects/${name}/?$`);

    const urlRedirect = this.page
      .waitForURL(targetUrlPattern, { timeout: 60_000 })
      .catch(() => undefined);
    const apiConfirm = waitForProjectCreated(name, { timeoutMs: 60_000 });

    await copyButton.click();
    await Promise.race([urlRedirect, apiConfirm]);

    if (!targetUrlPattern.test(this.page.url())) {
      const targetUrl = new URL(`/projects/${name}`, this.page.url()).toString();
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
  }
}
