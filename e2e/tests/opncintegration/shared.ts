import { Page } from '@playwright/test';
import { ALICE_USER } from '../../utils/test-users';
import { logInfo, logWarn } from '../../utils/logger';
import {
  deleteUploadedTestFile,
  ensureUserIsAdmin,
  ensureUserIsProjectMember,
} from '../../utils/test-helpers';
import {
  deleteWorkPackageFileLinksByName,
  findOpenProjectUser,
  listWorkPackageFileLinks,
  setUserAdmin,
} from '../../utils/openproject-api';
import type { EnsureAdminResult } from '../../utils/openproject-api';
import { OpenProjectHomePage } from '../../pageobjects/openproject';

export const ALICE_IDENTIFIERS = [
  ALICE_USER.username,
  ALICE_USER.email,
  `${ALICE_USER.username}@example.com`,
].filter((identifier, index, all): identifier is string => {
  return Boolean(identifier) && all.indexOf(identifier) === index;
});

export const uploadedFileName = `op-to-nc-upload-${Date.now()}.md`;
export const keepBothSiblingPattern = (() => {
  const dot = uploadedFileName.lastIndexOf('.');
  const stem = dot > 0 ? uploadedFileName.slice(0, dot) : uploadedFileName;
  const ext = dot > 0 ? uploadedFileName.slice(dot) : '';
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escape(stem)} \\(\\d+\\)${escape(ext)}`);
})();
export const ampProjectFolder = 'Demo project (1)';
export const replacedFileBody = Buffer.from(
  `## collision-replace-marker\nReplaced body ${Date.now()}\n`,
  'utf8'
);

export let aliceWasAdminBeforeSuite = false;
export let aliceAdminElevatedBySuite = false;

export async function captureAliceAdminStatus(): Promise<void> {
  for (const identifier of ALICE_IDENTIFIERS) {
    const user = await findOpenProjectUser(identifier);
    if (user) {
      aliceWasAdminBeforeSuite = user.admin;
      return;
    }
  }
}

export async function cleanupCollisionArtifacts(): Promise<void> {
  const names = new Set<string>([uploadedFileName]);
  try {
    const links = await listWorkPackageFileLinks(2);
    for (const link of links) {
      const name = link.originData?.name ?? link._links.self.title;
      if (name && keepBothSiblingPattern.test(name)) {
        names.add(name);
      }
    }
  } catch (err: unknown) {
    logWarn('[Cleanup] Failed to list work package file links:', err);
  }

  for (const name of names) {
    try {
      const deletedLinks = await deleteWorkPackageFileLinksByName(2, name);
      logInfo(`[Cleanup] Deleted file links for ${name}:`, deletedLinks);
    } catch (err: unknown) {
      logWarn(`[Cleanup] Failed to delete file links for ${name}:`, err);
    }

    try {
      await deleteUploadedTestFile(name, ampProjectFolder, ALICE_USER);
      logInfo(`[Cleanup] Deleted ${name} from ${ampProjectFolder}`);
    } catch (err: unknown) {
      logWarn(`[Cleanup] Failed to delete ${name} from Nextcloud:`, err);
    }
  }
}

export async function withAliceIdentifier<T>(
  action: (identifier: string) => Promise<T>
): Promise<T> {
  let lastError: unknown;
  for (const identifier of ALICE_IDENTIFIERS) {
    try {
      return await action(identifier);
    } catch (error: unknown) {
      lastError = error;
      if (!(error instanceof Error) || !error.message.includes('not found via API')) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('OpenProject user for Alice not found via API');
}

export async function ensureAliceAdmin(): Promise<EnsureAdminResult> {
  return withAliceIdentifier((identifier) => ensureUserIsAdmin(identifier));
}

export async function ensureAliceIsDemoProjectMember(): Promise<void> {
  await withAliceIdentifier((identifier) =>
    ensureUserIsProjectMember(identifier, 'demo-project')
  );
}

export async function ensureAliceAdminForCurrentSession(
  page: Page,
  homePage: OpenProjectHomePage
): Promise<void> {
  const { updated } = await ensureAliceAdmin();
  if (updated) {
    aliceAdminElevatedBySuite = true;
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await homePage.waitForReady({ dismissOnboarding: false });
}

export async function restoreAliceAdminStatus(): Promise<void> {
  if (aliceAdminElevatedBySuite && !aliceWasAdminBeforeSuite) {
    try {
      await withAliceIdentifier(async (identifier) => {
        const user = await findOpenProjectUser(identifier);
        if (!user) {
          throw new Error('OpenProject user for Alice not found via API');
        }
        await setUserAdmin(user.id, false);
      });
      logInfo('[Cleanup] Revoked admin permissions from Alice');
    } catch (err: unknown) {
      logWarn('[Cleanup] Failed to revoke admin permissions from Alice:', err);
    }
  }
}
