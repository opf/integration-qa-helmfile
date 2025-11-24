import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';

export abstract class OpenProjectBasePage extends BasePage {
  constructor(page: Page) {
    super(page, 'openproject.json');
  }

  protected getUrlEnvVar(): string {
    return 'OPENPROJECT_URL';
  }

  protected get baseUrl(): string {
    return process.env.OPENPROJECT_URL || this.locators.url.replace('/login', '');
  }
}

