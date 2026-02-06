import { Page } from '@playwright/test';
import {
  AdminCredentials,
  EnsureAdminResult,
  OpenProjectApiProjectStorage,
  OpenProjectApiStorage,
  deleteProject,
  ensureUserIsAdmin,
  findProjectByIdentifierOrName,
  listProjectStorages,
  listStorages,
} from './openproject-api';
import { deleteNextcloudFile } from './nextcloud-api';
import { OpenProjectProjectStoragesPage } from '../pageobjects/openproject';
import type { TestUser } from './test-users';

export { ensureUserIsAdmin, deleteProject };

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

  const storagesPage = new OpenProjectProjectStoragesPage(page);
  await storagesPage.navigateToProjectStorages(project.identifier);

  if (await storagesPage.hasNextcloudStorage()) {
    return;
  }

  await storagesPage.addNextcloudStorage();
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

/**
 * Delete an uploaded test file from Nextcloud via WebDAV.
 * Uses Keycloak OIDC token for the given user (e.g. ALICE_USER).
 *
 * @param fileName - e.g. 'op-to-nc-upload-test.md'
 * @param projectFolder - e.g. 'Demo project (1)'
 * @param user - e.g. ALICE_USER
 */
export async function deleteUploadedTestFile(
  fileName: string,
  projectFolder: string,
  user: TestUser
): Promise<void> {
  const filePath = `OpenProject/${projectFolder}/${fileName}`;
  await deleteNextcloudFile(filePath, user);
}