import { Page } from '@playwright/test';
import { OpenProjectBasePage } from './OpenProjectBasePage';
import { logDebug, logWarn } from '../../utils/logger';
import { waitForProjectCreated } from '../../utils/openproject-api';

export class OpenProjectHomePage extends OpenProjectBasePage {
  private static readonly FIRST_LOGIN_PROMPT_PASSES = 3;

  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.waitForOpenProjectUrl(15000);
    await this.dismissFirstLoginPromptsIfPresent();
    const userProfileButton = this.getLocator('userProfileButton').first();
    await userProfileButton.waitFor({ state: 'visible', timeout: 10000 });
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
    const nextButton = this.getLocator('tutorialNextButton').first();

    const isSkipVisible = await skipButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isSkipVisible) return false;

    const isNextVisible = await nextButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isNextVisible) return false;

    logDebug('[OpenProject] Tutorial overlay detected, skipping it');

    try {
      await skipButton.click();
      await skipButton.waitFor({ state: 'hidden', timeout: 10000 });
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
      return false;
    }
  }

  async getUserNameFromProfile(): Promise<string> {
    // Tutorial / language prompts may appear late; dismiss right before interacting.
    await this.dismissFirstLoginPromptsIfPresent();

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
    return userName?.trim() || '';
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

