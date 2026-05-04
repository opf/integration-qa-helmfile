import type { Locator, Page, Response } from '@playwright/test';
import { OpenProjectBasePage } from './OpenProjectBasePage';
import { logDebug, logWarn } from '../../utils/logger';
import { waitForProjectCreated } from '../../utils/openproject-api';

export class OpenProjectHomePage extends OpenProjectBasePage {
  private static readonly FIRST_LOGIN_PROMPT_PASSES = 3;
  private firstTimeTourExpected = false;
  private responseListener?: (response: Response) => void;

  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.waitForOpenProjectUrl(15000);
    this.installFirstLoginSignalListeners();
    await this.dismissFirstLoginPromptsIfPresent();
    this.uninstallFirstLoginSignalListeners();
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
    const skipButton = this.getLocator('tutorialSkipButton').first();
    const signalExpectsTour = this.isFirstTimeUserUrl() || this.firstTimeTourExpected;
    const skipWaitTimeout = signalExpectsTour ? 15_000 : 1_000;

    try {
      await skipButton.waitFor({ state: 'visible', timeout: skipWaitTimeout });
    } catch {
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

  getLinkedWorkPackageFileItem(fileName: string): Locator {
    return this.getLocator('workPackageLinkedFileItem').filter({ hasText: fileName }).first();
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
