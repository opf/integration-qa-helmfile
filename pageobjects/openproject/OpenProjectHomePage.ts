import { Page } from '@playwright/test';
import { OpenProjectBasePage } from './OpenProjectBasePage';

export class OpenProjectHomePage extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*openproject\.test.*/, { timeout: 15000 });
    const userProfileButton = this.getLocator('userProfileButton').first();
    await userProfileButton.waitFor({ state: 'visible', timeout: 10000 });
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

    await Promise.all([
      this.page.waitForURL(targetUrlPattern, { timeout: 20000 }),
      copyButton.click(),
    ]);
  }
}

