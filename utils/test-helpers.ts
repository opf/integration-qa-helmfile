import { Page } from '@playwright/test';
import {
  AdminCredentials,
  EnsureAdminResult,
  OpenProjectApiProjectStorage,
  OpenProjectApiStorage,
  ensureUserIsAdmin,
  findProjectByIdentifierOrName,
  listProjectStorages,
  listStorages,
} from './openproject-api';
import { OpenProjectHomePage } from '../pageobjects/openproject';

export { ensureUserIsAdmin };

export interface ProjectRef {
  id: number;
  identifier: string;
  name: string;
}

export interface ProjectStorageSummary {
  id: number;
  storageHref: string;
}

export async function ensureProjectExists(
  keyOrName: string,
  credentials?: AdminCredentials
): Promise<ProjectRef> {
  const project = await findProjectByIdentifierOrName(keyOrName, credentials);

  if (!project) {
    throw new Error(
      `OpenProject project '${keyOrName}' not found via API. ` +
        'Ensure the demo project exists in the test environment.'
    );
  }

  return {
    id: project.id,
    identifier: project.identifier,
    name: project.name,
  };
}

async function findNextcloudStorage(
  credentials?: AdminCredentials
): Promise<OpenProjectApiStorage | undefined> {
  const storages = await listStorages(credentials);
  const nextcloudStorage = storages.find((storage) =>
    storage.name.toLowerCase().includes('nextcloud')
  );

  return nextcloudStorage;
}

function getStorageHrefFromLink(linkHref: string): string {
  const idx = linkHref.indexOf('/api/v3');
  return idx >= 0 ? linkHref.slice(idx) : linkHref;
}

export async function getProjectStorages(
  projectIdentifier: string,
  credentials?: AdminCredentials
): Promise<ProjectStorageSummary[]> {
  const project = await ensureProjectExists(projectIdentifier, credentials);
  const storages = await listProjectStorages(project.id, credentials);

  return storages.map((projectStorage) => ({
    id: projectStorage.id,
    storageHref: getStorageHrefFromLink(projectStorage._links.storage.href),
  }));
}

export async function ensureProjectHasNextcloudStorage(
  projectIdentifier: string,
  page: Page | undefined,
  credentials?: AdminCredentials
): Promise<void> {
  const project = await ensureProjectExists(projectIdentifier, credentials);
  const projectStorages = await listProjectStorages(project.id, credentials);

  const nextcloudStorage = await findNextcloudStorage(credentials);

  if (!nextcloudStorage) {
    throw new Error(
      'No Nextcloud storage instance found via OpenProject API. ' +
        'Ensure Nextcloud integration is configured at the instance level.'
    );
  }

  const nextcloudStorageHref = `/api/v3/storages/${nextcloudStorage.id}`;

  const alreadyLinked = projectStorages.some((projectStorage: OpenProjectApiProjectStorage) => {
    const storageHref = getStorageHrefFromLink(projectStorage._links.storage.href);
    return storageHref === nextcloudStorageHref;
  });

  if (alreadyLinked) {
    return;
  }

  if (!page) {
    throw new Error(
      `Nextcloud storage is not yet linked to project '${project.identifier}', ` +
        'and no Page was provided for UI fallback. Pass a Playwright Page to allow UI-based creation.'
    );
  }

  if (project.identifier !== 'demo-project') {
    throw new Error(
      `UI-based storage creation is currently only implemented for the 'demo-project' identifier, got '${project.identifier}'.`
    );
  }

  const homePage = new OpenProjectHomePage(page);
  await homePage.navigateToDemoProjectStoragesExternal();
  await homePage.waitForDemoProjectStoragesExternalUrl();

  const nextcloudStorageRow = homePage.getLocator('nextcloudStorageRow');
  const existingStorageCount = await nextcloudStorageRow.count();
  if (existingStorageCount > 0) {
    return;
  }

  const newStorageLink = homePage.getLocator('newStorageLink');
  await newStorageLink.waitFor({ state: 'visible', timeout: 10000 });
  await newStorageLink.click();
  await homePage.waitForDemoProjectStoragesNewUrl();

  const addFileStorageHeading = homePage.getLocator('addFileStorageHeading').first();
  await addFileStorageHeading.waitFor({ state: 'visible', timeout: 10000 });

  const storageDropdown = homePage.getLocator('storageDropdown');
  await storageDropdown.waitFor({ state: 'visible', timeout: 10000 });

  const selectedOption = storageDropdown.locator('option:checked');
  let selectedText = (await selectedOption.textContent())?.toLowerCase() ?? '';
  if (!selectedText.includes('nextcloud')) {
    const nextcloudOption = storageDropdown.locator('option', { hasText: /nextcloud/i }).first();
    if (await nextcloudOption.count() === 0) {
      throw new Error('Nextcloud option is not available in the storage dropdown.');
    }
    const nextcloudValue = await nextcloudOption.getAttribute('value');
    if (!nextcloudValue) {
      throw new Error('Nextcloud option is missing a value attribute.');
    }
    await storageDropdown.selectOption(nextcloudValue);
  }

  const continueButton = homePage.getLocator('continueButton');
  await continueButton.waitFor({ state: 'visible', timeout: 10000 });
  await continueButton.click();

  const automaticFolderModeRadio = homePage.getLocator('automaticFolderModeRadio');
  await automaticFolderModeRadio.waitFor({ state: 'visible', timeout: 10000 });
  if (!(await automaticFolderModeRadio.isChecked())) {
    await automaticFolderModeRadio.check();
  }

  const addButton = homePage.getLocator('addButton');
  await addButton.waitFor({ state: 'visible', timeout: 10000 });
  await addButton.click();

  const successMessage = homePage.getLocator('storageCreationSuccessMessage');
  await successMessage.waitFor({ state: 'visible', timeout: 15000 });
}

export async function ensureProjectHasNoNextcloudStorage(
  projectIdentifier: string,
  credentials?: AdminCredentials
): Promise<void> {
  const project = await ensureProjectExists(projectIdentifier, credentials);
  const projectStorages = await listProjectStorages(project.id, credentials);
  const nextcloudStorage = await findNextcloudStorage(credentials);

  if (!nextcloudStorage || projectStorages.length === 0) {
    return;
  }

  const nextcloudStorageHref = `/api/v3/storages/${nextcloudStorage.id}`;
  const linked = projectStorages.some((projectStorage: OpenProjectApiProjectStorage) => {
    const storageHref = getStorageHrefFromLink(projectStorage._links.storage.href);
    return storageHref === nextcloudStorageHref;
  });

  if (linked) {
    throw new Error(
      `API v3 does not expose write operations for project storages. ` +
        `Please remove the Nextcloud storage for project '${project.identifier}' via the UI or admin settings.`
    );
  }
}

export async function ensureUserIsAdminWithRevokeFlag(
  identifier: string,
  credentials?: AdminCredentials
): Promise<EnsureAdminResult> {
  return ensureUserIsAdmin(identifier, credentials);
}

export async function ensureDemoProjectCopyViaUi(
  page: Page,
  newIdentifier: string
): Promise<void> {
  const homePage = new OpenProjectHomePage(page);
  await homePage.waitForReady();
  await homePage.navigateToAllProjects();
  await homePage.copyDemoProjectTo(newIdentifier);
}

