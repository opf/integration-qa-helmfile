import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';
import { testConfig } from '../../utils/config';
import { resolveServiceNavigationUrl } from '../../utils/url-helpers';

export abstract class NextcloudBasePage extends BasePage {
  constructor(page: Page) {
    super(page, 'nextcloud.json');
  }

  protected getUrlEnvVar(): string {
    return 'NEXTCLOUD_URL';
  }

  protected resolveNavigationUrl(): string {
    return resolveServiceNavigationUrl(
      process.env.NEXTCLOUD_URL,
      process.env.NEXTCLOUD_HOST,
      testConfig.nextcloud.host,
      this.locators.url,
    );
  }

  protected get baseUrl(): string {
    return resolveServiceNavigationUrl(
      process.env.NEXTCLOUD_URL,
      process.env.NEXTCLOUD_HOST,
      testConfig.nextcloud.host,
      this.locators.url,
    );
  }
}

