import { Page } from '@playwright/test';
import {
  AdminCredentials,
  OpenProjectApiProjectStorage,
  OpenProjectApiStorage,
  deleteProject,
  ensureUserIsAdmin,
  findProjectByIdentifierOrName,
  listProjectStorages,
  listStorages,
  waitForNextcloudStorageHealthy,
  ensureUserIsProjectMember,
  ensureUserIsNotProjectMember,
} from './openproject-api';
import { deleteNextcloudFile } from './nextcloud-api';
import {
  OpenProjectHomePage,
  OpenProjectProjectStoragesPage,
} from '../pageobjects/openproject';
import type { TestUser } from './test-users';

export {
  ensureUserIsAdmin,
  ensureUserIsProjectMember,
  ensureUserIsNotProjectMember,
  deleteProject,
  waitForNextcloudStorageHealthy,
};

async function ensureProjectExists(
  keyOrName: string,
  credentials?: AdminCredentials
): Promise<{ id: number; identifier: string; name: string }> {
  const project = await findProjectByIdentifierOrName(keyOrName, credentials);

  if (!project) {
    throw new Error(
      `OpenProject project '${keyOrName}' not found via API. ` +
        'Ensure the demo project exists in the test environment.'
    );
  }

  return { id: project.id, identifier: project.identifier, name: project.name };
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

/** True when Demo (or other) project already has the instance Nextcloud storage linked. */
export async function isProjectNextcloudStorageLinked(
  projectIdentifier: string,
  credentials?: AdminCredentials
): Promise<boolean> {
  const project = await ensureProjectExists(projectIdentifier, credentials);
  const projectStorages = await listProjectStorages(project.id, credentials);
  const nextcloudStorage = await findNextcloudStorage(credentials);
  if (!nextcloudStorage) {
    return false;
  }
  const nextcloudStorageHref = `/api/v3/storages/${nextcloudStorage.id}`;
  return projectStorages.some((projectStorage: OpenProjectApiProjectStorage) => {
    const storageHref = getStorageHrefFromLink(projectStorage._links.storage.href);
    return storageHref === nextcloudStorageHref;
  });
}

export async function ensureProjectHasNextcloudStorage(
  projectIdentifier: string,
  page: Page | undefined,
  credentials?: AdminCredentials
): Promise<void> {
  if (await isProjectNextcloudStorageLinked(projectIdentifier, credentials)) {
    return;
  }

  const project = await ensureProjectExists(projectIdentifier, credentials);
  const nextcloudStorage = await findNextcloudStorage(credentials);

  if (!nextcloudStorage) {
    throw new Error(
      'No Nextcloud storage instance found via OpenProject API. ' +
        'Ensure Nextcloud integration is configured at the instance level.'
    );
  }

  if (!page) {
    throw new Error(
      `Nextcloud storage is not yet linked to project '${project.identifier}', ` +
        'and no Page was provided for UI fallback. Pass a Playwright Page to allow UI-based creation.'
    );
  }

  const storagesPage = new OpenProjectProjectStoragesPage(page);
  await storagesPage.navigateToProjectStorages(project.identifier);
  // Onboarding enjoyhint can reappear after navigation and block "New storage".
  const homePage = new OpenProjectHomePage(page);
  await homePage.dismissTutorialOverlayIfPresent();

  if (await storagesPage.hasNextcloudStorage()) {
    return;
  }

  await storagesPage.addNextcloudStorage();
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