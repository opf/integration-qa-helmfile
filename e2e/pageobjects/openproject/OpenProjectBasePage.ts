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

  // URL path constants
  static readonly URL_PATHS = {
    OPENPROJECT_DOMAIN: /.*openproject\.test.*/,
    DEMO_PROJECT: /.*\/projects\/demo-project.*/,
    DEMO_PROJECT_SETTINGS_GENERAL: /.*\/projects\/demo-project\/settings\/general.*/,
    DEMO_PROJECT_STORAGES_EXTERNAL: /.*\/projects\/demo-project\/settings\/project_storages\/external_file_storages.*/,
    DEMO_PROJECT_STORAGES_NEW: /.*\/projects\/demo-project\/settings\/project_storages\/new.*/,
    ADMIN_SETTINGS_STORAGES: /.*\/admin\/settings\/storages\/?$/,
    ADMIN_STORAGE_PROJECTS: /.*\/admin\/settings\/storages\/\d+\/project_storages\/?$/,
    ADMIN_STORAGE_PROJECTS_NEW: /.*\/admin\/settings\/storages\/\d+\/project_storages\/new\/?$/,
  } as const;

  // Full URL paths (for navigation)
  static readonly URLS = {
    DEMO_PROJECT_STORAGES_EXTERNAL: '/projects/demo-project/settings/project_storages/external_file_storages',
    ADMIN_SETTINGS_STORAGES: '/admin/settings/storages',
  } as const;

  /**
   * Wait for URL to match OpenProject domain pattern
   */
  async waitForOpenProjectUrl(timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(OpenProjectBasePage.URL_PATHS.OPENPROJECT_DOMAIN, { timeout });
  }

  /**
   * Wait for URL to match demo project pattern
   */
  async waitForDemoProjectUrl(timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(OpenProjectBasePage.URL_PATHS.DEMO_PROJECT, { timeout });
  }

  /**
   * Wait for URL to match demo project settings general pattern
   */
  async waitForDemoProjectSettingsGeneralUrl(timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(OpenProjectBasePage.URL_PATHS.DEMO_PROJECT_SETTINGS_GENERAL, { timeout });
  }

  /**
   * Wait for URL to match demo project storages external pattern
   */
  async waitForDemoProjectStoragesExternalUrl(timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(OpenProjectBasePage.URL_PATHS.DEMO_PROJECT_STORAGES_EXTERNAL, { timeout });
  }

  /**
   * Wait for URL to match demo project storages new pattern
   */
  async waitForDemoProjectStoragesNewUrl(timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(OpenProjectBasePage.URL_PATHS.DEMO_PROJECT_STORAGES_NEW, { timeout });
  }

  /**
   * Navigate to demo project external file storages page
   */
  async navigateToDemoProjectStoragesExternal(): Promise<void> {
    const url = `${this.baseUrl}${OpenProjectBasePage.URLS.DEMO_PROJECT_STORAGES_EXTERNAL}`;
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
  }

  /**
   * Navigate to admin storage settings page
   */
  async navigateToAdminStoragesSettings(): Promise<void> {
    const url = `${this.baseUrl}${OpenProjectBasePage.URLS.ADMIN_SETTINGS_STORAGES}`;
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
  }

  /**
   * Wait for admin storage pages
   */
  async waitForAdminStoragesSettingsUrl(timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(OpenProjectBasePage.URL_PATHS.ADMIN_SETTINGS_STORAGES, { timeout });
  }

  async waitForAdminStorageProjectsUrl(timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(OpenProjectBasePage.URL_PATHS.ADMIN_STORAGE_PROJECTS, { timeout });
  }

  async waitForAdminStorageProjectsNewUrl(timeout: number = 15000): Promise<void> {
    await this.page.waitForURL(OpenProjectBasePage.URL_PATHS.ADMIN_STORAGE_PROJECTS_NEW, { timeout });
  }
}

