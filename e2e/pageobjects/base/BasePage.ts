import { Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { resolveLocator, LocatorDescriptor, LocatorMap } from '../../utils/locator-resolver';

export interface LocatorsFile {
  url: string;
  selectors: LocatorMap;
}

/**
 * Base PageObject class with common functionality
 * All PageObjects should extend this class
 */
export abstract class BasePage {
  protected page: Page;
  protected locators: LocatorsFile;

  constructor(page: Page, locatorsPath: string) {
    this.page = page;
    this.locators = this.loadLocators(locatorsPath);
  }

  /**
   * Load locators from JSON file
   */
  protected loadLocators(locatorsPath: string): LocatorsFile {
    // Resolve path relative to project root (e2e directory)
    const projectRoot = path.resolve(__dirname, '../..');
    const fullPath = path.resolve(projectRoot, 'locators', locatorsPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(content) as LocatorsFile;
  }

  /**
   * Resolve a locator by key from the loaded locators
   */
  protected getLocator(key: string): Locator {
    const descriptor = this.locators.selectors[key];
    if (!descriptor) {
      throw new Error(`Locator '${key}' not found in locators file`);
    }
    return resolveLocator(this.page, descriptor);
  }

  /**
   * Navigate to the page URL
   */
  async navigateTo(): Promise<void> {
    const url = process.env[this.getUrlEnvVar()] || this.locators.url;
    console.log(`[PAGE NAVIGATION] Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    console.log(`[PAGE NAVIGATION] Current URL: ${this.page.url()}`);
    console.log(`[PAGE NAVIGATION] Page title: ${await this.page.title()}`);
  }

  /**
   * Get the environment variable name for the URL
   * Override in subclasses if needed
   */
  protected getUrlEnvVar(): string {
    return '';
  }

  /**
   * Wait for the page to be ready
   * Override in subclasses for specific readiness checks
   */
  async waitForReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Take a screenshot
   */
  async screenshot(filename: string): Promise<void> {
    const projectRoot = path.resolve(__dirname, '../..');
    const screenshotsDir = path.resolve(projectRoot, 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    await this.page.screenshot({ 
      path: path.join(screenshotsDir, filename),
      fullPage: true 
    });
  }
}

