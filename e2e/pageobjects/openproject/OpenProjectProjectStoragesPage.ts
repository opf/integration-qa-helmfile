import { Page } from '@playwright/test';
import { OpenProjectBasePage } from './OpenProjectBasePage';

/**
 * Page object for a project's external file storages settings page.
 * Supports adding Nextcloud storage via the UI.
 */
export class OpenProjectProjectStoragesPage extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to a project's external file storages page.
   */
  async navigateToProjectStorages(projectIdentifier: string): Promise<void> {
    await this.navigateToProjectStoragesExternal(projectIdentifier);
    const escaped = projectIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `.*/projects/${escaped}/settings/project_storages/external_file_storages.*`
    );
    await this.page.waitForURL(pattern, { timeout: 15000 });
  }

  /**
   * Check if Nextcloud storage row is already present on the page.
   * Assumes we are on the project storages external page.
   */
  async hasNextcloudStorage(): Promise<boolean> {
    const nextcloudStorageRow = this.getLocator('nextcloudStorageRow');
    const count = await nextcloudStorageRow.count();
    return count > 0;
  }

  /**
   * Add Nextcloud storage to the current project via the UI.
   * Assumes we are on the project storages external page and storage is not yet linked.
   */
  async addNextcloudStorage(): Promise<void> {
    const newStorageLink = this.getLocator('newStorageLink');
    await newStorageLink.waitFor({ state: 'visible', timeout: 10000 });
    await newStorageLink.click();
    await this.page.waitForURL(/\/projects\/[^/]+\/settings\/project_storages\/new/, {
      timeout: 15000,
    });

    const addFileStorageHeading = this.getLocator('addFileStorageHeading').first();
    await addFileStorageHeading.waitFor({ state: 'visible', timeout: 10000 });

    const storageDropdown = this.getLocator('storageDropdown');
    await storageDropdown.waitFor({ state: 'visible', timeout: 10000 });

    const selectedOption = storageDropdown.locator('option:checked');
    const selectedText = (await selectedOption.textContent())?.toLowerCase() ?? '';
    if (!selectedText.includes('nextcloud')) {
      const nextcloudOption = storageDropdown.locator('option', { hasText: /nextcloud/i }).first();
      if ((await nextcloudOption.count()) === 0) {
        throw new Error('Nextcloud option is not available in the storage dropdown.');
      }
      const nextcloudValue = await nextcloudOption.getAttribute('value');
      if (!nextcloudValue) {
        throw new Error('Nextcloud option is missing a value attribute.');
      }
      await storageDropdown.selectOption(nextcloudValue);
    }

    const continueButton = this.getLocator('continueButton');
    await continueButton.waitFor({ state: 'visible', timeout: 10000 });
    await continueButton.click();

    const automaticFolderModeRadio = this.getLocator('automaticFolderModeRadio');
    await automaticFolderModeRadio.waitFor({ state: 'visible', timeout: 10000 });
    if (!(await automaticFolderModeRadio.isChecked())) {
      await automaticFolderModeRadio.check();
    }

    const addButton = this.getLocator('addButton');
    await addButton.waitFor({ state: 'visible', timeout: 10000 });
    await addButton.click();

    const successMessage = this.getLocator('storageCreationSuccessMessage');
    await successMessage.waitFor({ state: 'visible', timeout: 15000 });
  }
}
