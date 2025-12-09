import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';

export class NextcloudActiveAppsPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    const url = `${this.baseUrl}/settings/apps/enabled`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/settings\/apps\/enabled.*/, { timeout: 10000 });
    await this.getLocator('activeAppsText').waitFor({ state: 'visible', timeout: 10000 });
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

