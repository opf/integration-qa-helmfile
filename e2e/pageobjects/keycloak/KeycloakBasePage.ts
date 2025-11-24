import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';

export abstract class KeycloakBasePage extends BasePage {
  constructor(page: Page) {
    super(page, 'keycloak.json');
  }

  protected getUrlEnvVar(): string {
    return 'KEYCLOAK_URL';
  }

  protected get baseUrl(): string {
    return process.env.KEYCLOAK_URL || this.locators.url;
  }
}

