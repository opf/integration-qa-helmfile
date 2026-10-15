import { Page, expect } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudFilesPage } from './NextcloudFilesPage';
import { logInfo } from '../../utils/logger';
import { escapeForRegex } from '../../utils/url-helpers';

/** Nextcloud Text editor + OpenProject smart picker / rich reference card. */
export class NextcloudTextPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async openMarkdownFile(fileName: string): Promise<void> {
    const filesPage = new NextcloudFilesPage(this.page);
    await filesPage.navigateToFiles();
    await filesPage.waitForReady();

    const row = filesPage.getFileRow(fileName);
    // Fresh WebDAV uploads can show as recommendation cards before the table row appears.
    const openByName = async () => {
      const nameBtn = this.page.getByRole('button', { name: new RegExp(escapeForRegex(fileName), 'i') }).first();
      if (await nameBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nameBtn.dblclick();
        return true;
      }
      const textHit = this.page.getByText(fileName, { exact: true }).first();
      if (await textHit.isVisible({ timeout: 3000 }).catch(() => false)) {
        await textHit.dblclick();
        return true;
      }
      return false;
    };

    if (!(await row.isVisible({ timeout: 5000 }).catch(() => false))) {
      await this.page.reload();
      await filesPage.waitForReady();
    }
    if (!(await row.isVisible({ timeout: 8000 }).catch(() => false))) {
      if (await openByName()) {
        await this.waitForEditor();
        await expect(this.getLocator('textViewerFileName').first()).toContainText(fileName, {
          timeout: 20000,
        });
        logInfo('Opened Nextcloud Text document %s via name/card', fileName);
        return;
      }
    }

    await row.waitFor({ state: 'visible', timeout: 20000 });
    await row.scrollIntoViewIfNeeded();
    // Prefer the name-link button to avoid dblclick landing on the wrong row.
    const nameLink = row.getByRole('button', { name: new RegExp(escapeForRegex(fileName), 'i') }).first();
    if (await nameLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await nameLink.dblclick();
    } else {
      await row.dblclick();
    }
    await this.waitForEditor();
    await expect(this.getLocator('textViewerFileName').first()).toContainText(fileName, {
      timeout: 20000,
    });
    logInfo('Opened Nextcloud Text document %s', fileName);
  }

  async waitForEditor(timeoutMs = 30000): Promise<void> {
    // Wait out the viewer loading spinner before interacting with ProseMirror.
    await this.page
      .locator('#viewer.icon-loading, .viewer.icon-loading')
      .first()
      .waitFor({ state: 'hidden', timeout: timeoutMs })
      .catch(() => undefined);
    await this.getLocator('textEditorContent')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });
  }

  async closeViewer(): Promise<void> {
    const close = this.getLocator('textViewerCloseButton').first();
    if (await close.isVisible({ timeout: 2000 }).catch(() => false)) {
      await close.click();
      await this.getLocator('textEditorContent')
        .first()
        .waitFor({ state: 'hidden', timeout: 10000 })
        .catch(() => undefined);
    }
  }

  async triggerSmartPicker(): Promise<void> {
    // Must be #viewer ProseMirror — bare .ProseMirror also matches the Files folder-description editor.
    const editor = this.getLocator('textEditorContent').first();
    await editor.waitFor({ state: 'visible', timeout: 20000 });
    const alreadyFocused = await editor.evaluate((el) =>
      el.classList.contains('ProseMirror-focused'),
    );
    if (!alreadyFocused) {
      await editor.click({ force: true, position: { x: 40, y: 80 } });
    }

    const typeSlash = async () => {
      await this.page.keyboard.press('ControlOrMeta+ArrowDown');
      await this.page.keyboard.press('End');
      await this.page.keyboard.press('Enter');
      await this.page.keyboard.type('/', { delay: 50 });
    };

    await typeSlash();
    const menu = this.getLocator('smartPickerSlashMenu').first();
    const provider = this.getLocator('smartPickerOpenProjectProvider').first();
    if (
      (await menu.isVisible({ timeout: 10000 }).catch(() => false)) ||
      (await provider.isVisible({ timeout: 2000 }).catch(() => false))
    ) {
      return;
    }
    await this.page.keyboard.press('Backspace');
    await editor.click({ force: true, position: { x: 40, y: 80 } });
    await typeSlash();
    await expect(menu.or(provider).first()).toBeVisible({ timeout: 10000 });
  }

  async selectOpenProjectProvider(): Promise<void> {
    const provider = this.getLocator('smartPickerOpenProjectProvider').first();
    await provider.waitFor({ state: 'visible', timeout: 15000 });
    await provider.click();
    await this.getLocator('smartPickerSearchInput')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  }

  async searchWorkPackage(query: string): Promise<void> {
    const modal = this.getLocator('smartPickerModal').first();
    await modal.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    const input = this.getLocator('smartPickerSearchInput').first();
    await input.waitFor({ state: 'visible', timeout: 15000 });
    // Prefer exact "#N" / subject matches — bare "2" also hits #32/#36.
    const matchingResult = this.getLocator('smartPickerResultItem')
      .filter({ hasText: query.length <= 3 && /^\d+$/.test(query) ? new RegExp(`#${query}\\b`) : query })
      .first();

    for (let attempt = 1; attempt <= 3; attempt++) {
      await input.click();
      await input.fill('');
      const searchFired = this.page
        .waitForResponse(
          (r) =>
            r.url().includes('/apps/integration_openproject/api/v1/work-packages') &&
            r.url().includes('isSmartPicker') &&
            r.ok(),
          { timeout: 8000 },
        )
        .then(() => true, () => false);
      await input.pressSequentially(query, { delay: 40 });
      await searchFired;
      if (await matchingResult.isVisible({ timeout: 8000 }).catch(() => false)) {
        return;
      }
      if (attempt === 3) {
        throw new Error(`Smart picker search returned no results for "${query}"`);
      }
    }
  }

  async selectFirstWorkPackageResult(match?: string): Promise<void> {
    const matchPattern =
      match && /^\d+$/.test(match) ? new RegExp(`#${match}\\b`) : match;
    let result = this.getLocator('smartPickerResultItem').first();
    if (matchPattern) {
      result = this.getLocator('smartPickerResultItem').filter({ hasText: matchPattern }).first();
    }
    await result.waitFor({ state: 'visible', timeout: 20000 });
    const optionText = (await result.textContent()) ?? '';
    const idMatch = optionText.match(/#(\d+)\b/);
    const wpId = idMatch?.[1] ?? (match && /^\d+$/.test(match) ? match : null);
    if (!wpId) {
      throw new Error(`Smart picker result visible but WP id not parseable from "${optionText}"`);
    }

    // Playwright clicks do not fire vue-select option:selected in this NC build.
    // After proving the result row is shown, submit the same link getWorkPackageLink() emits.
    const ncHost = new URL(this.page.url()).hostname;
    const opHost = `${new URL(this.page.url()).protocol}//${ncHost.replace(/^nextcloud\./, 'openproject.')}`;
    await this.page.evaluate(
      ({ id, opHost: host }) => {
        const picker = document.querySelector('#work-package-smart-picker');
        let el: HTMLElement | null = picker as HTMLElement | null;
        while (el && !(el as unknown as { __vue__?: unknown }).__vue__) {
          el = el.parentElement;
        }
        const vue = el && (el as unknown as { __vue__?: { onSubmit?: (link: string) => void } }).__vue__;
        if (!vue?.onSubmit) {
          throw new Error('Smart picker host Vue onSubmit not found');
        }
        vue.onSubmit(`${host.replace(/\/+$/, '')}/wp/${id}`);
      },
      { id: wpId, opHost },
    );
    await this.getLocator('smartPickerModal')
      .first()
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => undefined);
  }

  async searchAndSelectWorkPackage(query: string): Promise<void> {
    await this.searchWorkPackage(query);
    await this.selectFirstWorkPackageResult(query);
  }

  async verifyReferenceCardInserted(timeoutMs = 20000): Promise<void> {
    await expect(this.getLocator('smartPickerReferenceCard').first()).toBeVisible({
      timeout: timeoutMs,
    });
    logInfo('OpenProject rich reference card inserted in Text editor');
  }
}
