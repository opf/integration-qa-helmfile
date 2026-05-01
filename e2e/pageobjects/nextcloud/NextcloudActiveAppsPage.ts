import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';

export class NextcloudActiveAppsPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    const url = new URL('index.php/settings/apps/enabled', this.baseUrl).toString();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*(index\.php\/)?settings\/apps\/enabled.*/, { timeout: 20000 });
    const dismissedWizard = await this.dismissFirstRunWizardIfPresent(2000);
    if (dismissedWizard) {
      await this.navigateTo();
      await this.page.waitForURL(/.*(index\.php\/)?settings\/apps\/enabled.*/, { timeout: 20000 });
    }

    const activeAppsHeading = this.getLocator('activeAppsText').first();
    const activeAppsHeadingVisible = await activeAppsHeading
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!activeAppsHeadingVisible) {
      // Nextcloud versions/skins differ; the apps page can render without this exact heading.
      const settingsShell = this.page.locator('#content.app-settings');
      await settingsShell.first().waitFor({ state: 'visible', timeout: 20000 });
    }
  }

  async findOpenProjectIntegrationApp(): Promise<void> {
    const appRow = this.getLocator('openProjectIntegrationAppRow');
    
    try {
      await appRow.waitFor({ state: 'visible', timeout: 3000 });
      return;
    } catch {
      const appLink = this.getLocator('openProjectIntegrationAppLink');
      
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        try {
          const isVisible = await appLink.isVisible({ timeout: 1000 }).catch(() => false);
          if (isVisible) {
            await appLink.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(500);
            return;
          }
        } catch {
        }
        
        await this.page.evaluate(() => {
          window.scrollBy(0, 300);
        });
        await this.page.waitForTimeout(500);
        attempts++;
      }
      
      await appRow.waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  async getOpenProjectIntegrationAppVersion(): Promise<string> {
    await this.findOpenProjectIntegrationApp();
    const versionLocator = this.getLocator('openProjectIntegrationAppVersion');
    await versionLocator.waitFor({ state: 'visible', timeout: 10000 });
    const version = await versionLocator.textContent();
    return version?.trim() || '';
  }

  async isDisableButtonPresentForOpenProjectIntegration(): Promise<boolean> {
    try {
      await this.findOpenProjectIntegrationApp();
      const disableButton = this.getLocator('openProjectIntegrationDisableButton');
      return await disableButton.isVisible({ timeout: 5000 }).catch(() => false);
    } catch {
      return false;
    }
  }

  getOpenProjectIntegrationAppLink() {
    return this.getLocator('openProjectIntegrationAppLink');
  }
}
