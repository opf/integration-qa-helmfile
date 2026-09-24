import type { Page } from '@playwright/test';
import { waitForProjectCreated } from '../../utils/openproject-api';
import { OpenProjectBasePage } from './OpenProjectBasePage';

export class OpenProjectProjectListPage extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  async copyDemoProjectTo(name: string): Promise<void> {
    const demoProjectKebabButton = this.getLocator('demoProjectKebabButton').first();
    await demoProjectKebabButton.waitFor({ state: 'visible', timeout: 15000 });
    await demoProjectKebabButton.click();

    const copyActionItem = this.getLocator('projectActionsCopyItem').first();
    await copyActionItem.waitFor({ state: 'visible', timeout: 15000 });

    await Promise.all([
      this.page.waitForURL(/\/projects\/demo-project\/copy\/?$/, { timeout: 15000 }),
      copyActionItem.click(),
    ]);

    const nameInput = this.getLocator('copyProjectNameInput').first();
    await nameInput.waitFor({ state: 'visible', timeout: 15000 });
    await nameInput.fill(name);

    const copyButton = this.getLocator('copyProjectSubmitButton').first();
    await copyButton.waitFor({ state: 'visible', timeout: 15000 });

    const targetUrlPattern = new RegExp(`/projects/${name}/?$`);

    const urlRedirect = this.page
      .waitForURL(targetUrlPattern, { timeout: 60_000 })
      .catch(() => undefined);
    const apiConfirm = waitForProjectCreated(name, { timeoutMs: 60_000 });

    await copyButton.click();
    await Promise.race([urlRedirect, apiConfirm]);

    if (!targetUrlPattern.test(this.page.url())) {
      const targetUrl = new URL(`/projects/${name}`, this.page.url()).toString();
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
  }

  /**
   * Copy the demo project via UI: open the projects list, then duplicate demo to the given identifier.
   * Uses a direct goto so this works after other flows (e.g. ensureProjectHasNextcloudStorage)
   * that leave the browser on a project settings page where the home sidebar link is absent.
   */
  async copyDemoProjectViaUi(newIdentifier: string): Promise<void> {
    await this.page.goto(`${this.baseUrl}/projects`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await this.page.waitForURL(/\/projects\/?$/, { timeout: 15000 });
    await this.copyDemoProjectTo(newIdentifier);
  }
}
