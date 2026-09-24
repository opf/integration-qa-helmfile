import { Page } from '@playwright/test';
import { OpenProjectBasePage } from './OpenProjectBasePage';

/** Page object for the XWiki Wiki tab in OpenProject work packages. Stub for TC 2157. */
export class OpenProjectWorkPackageWikiTab extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  async isWikiTabVisible(): Promise<boolean> {
    try {
      return await this.getLocator('wikiTab').isVisible();
    } catch {
      return false;
    }
  }
}
