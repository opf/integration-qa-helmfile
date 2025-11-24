import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';

export abstract class NextcloudBasePage extends BasePage {
  constructor(page: Page) {
    super(page, 'nextcloud.json');
  }

  protected getUrlEnvVar(): string {
    return 'NEXTCLOUD_URL';
  }

  protected get baseUrl(): string {
    return process.env.NEXTCLOUD_URL || this.locators.url;
  }
}

