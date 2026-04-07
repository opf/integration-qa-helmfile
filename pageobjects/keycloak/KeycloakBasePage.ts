import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';
import { testConfig } from '../../utils/config';
import { resolveServiceNavigationUrl } from '../../utils/url-helpers';

export abstract class KeycloakBasePage extends BasePage {
  constructor(page: Page) {
    super(page, 'keycloak.json');
  }

  protected getUrlEnvVar(): string {
    return 'KEYCLOAK_URL';
  }

  protected resolveNavigationUrl(): string {
    return resolveServiceNavigationUrl(
      process.env.KEYCLOAK_URL,
      process.env.KEYCLOAK_HOST,
      testConfig.keycloak.host,
      this.locators.url,
    );
  }

  protected get baseUrl(): string {
    return resolveServiceNavigationUrl(
      process.env.KEYCLOAK_URL,
      process.env.KEYCLOAK_HOST,
      testConfig.keycloak.host,
      this.locators.url,
    );
  }
}

