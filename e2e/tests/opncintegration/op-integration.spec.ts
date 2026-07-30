import {
  test,
  expect,
  openProjectUrl,
  integrationTags,
} from '../base-test';
import type { Page } from '@playwright/test';
import {
  OpenProjectLoginPage,
  OpenProjectHomePage,
  OpenProjectProjectStoragesPage,
} from '../../pageobjects/openproject';
import { ALICE_USER } from '../../utils/test-users';
import {
  deleteProject,
  deleteUploadedTestFile,
  ensureProjectHasNextcloudStorage,
  ensureUserIsAdmin,
  ensureUserIsProjectMember,
  waitForNextcloudStorageHealthy,
} from '../../utils/test-helpers';
import {
  deleteWorkPackageFileLinksByName,
  findOpenProjectUser,
  listWorkPackageFileLinks,
  setUserAdmin,
} from '../../utils/openproject-api';
import type { EnsureAdminResult } from '../../utils/openproject-api';
import { testConfig } from '../../utils/config';
import { logInfo, logWarn } from '../../utils/logger';
import { squashTestCase } from '../../utils/squash-metadata';

const ALICE_IDENTIFIERS = [
  ALICE_USER.username,
  ALICE_USER.email,
  `${ALICE_USER.username}@example.com`,
].filter((identifier, index, all): identifier is string => {
  return Boolean(identifier) && all.indexOf(identifier) === index;
});

const uploadedFileName = `op-to-nc-upload-${Date.now()}.md`;
// Product contract: Nextcloud "Keep both" renames to `stem (N).ext` (observed N=2).
const keepBothSiblingPattern = (() => {
  const dot = uploadedFileName.lastIndexOf('.');
  const stem = dot > 0 ? uploadedFileName.slice(0, dot) : uploadedFileName;
  const ext = dot > 0 ? uploadedFileName.slice(dot) : '';
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escape(stem)} \\(\\d+\\)${escape(ext)}`);
})();
const ampProjectFolder = 'Demo project (1)';
const replacedFileBody = Buffer.from(
  `## collision-replace-marker\nReplaced body ${Date.now()}\n`,
  'utf8'
);

let aliceWasAdminBeforeSuite = false;
let aliceAdminElevatedBySuite = false;

// ponytail: only discovers siblings via OP file links; NC-only orphans without a link are not cleaned — upgrade: WebDAV list under AMPF folder.
async function cleanupCollisionArtifacts(): Promise<void> {
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

async function withAliceIdentifier<T>(
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

async function ensureAliceAdmin(): Promise<EnsureAdminResult> {
  return withAliceIdentifier((identifier) => ensureUserIsAdmin(identifier));
}

async function ensureAliceIsDemoProjectMember(): Promise<void> {
  await withAliceIdentifier((identifier) =>
    ensureUserIsProjectMember(identifier, 'demo-project')
  );
}

async function ensureAliceAdminForCurrentSession(
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

test.describe('SSO External - OpenProject Integration', integrationTags, () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test.beforeAll(async () => {
    for (const identifier of ALICE_IDENTIFIERS) {
      const user = await findOpenProjectUser(identifier);
      if (user) {
        aliceWasAdminBeforeSuite = user.admin;
        return;
      }
    }
  });

  test(
    'Access OpenProject via Keycloak user authentication',
    squashTestCase(2160, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      let keycloakLoginPage: Awaited<ReturnType<OpenProjectLoginPage['clickKeycloakAuthButton']>>;

      await test.step('Navigate to the OpenProject login page', async () => {
        await loginPage.navigateTo();
      });

      await test.step('Click the Keycloak authentication button', async () => {
        keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      });

      await test.step('Log in as test user', async () => {
        await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      });

      await test.step('Verify the user session on the OpenProject home page', async () => {
        const homePage = new OpenProjectHomePage(page);
        await homePage.waitForOpenProjectUrl();
        await homePage.waitForReady();

        const currentUrl = page.url();
        expect(currentUrl).not.toContain('/login');
        expect(currentUrl).toContain(testConfig.openproject.host);

        const isProfileButtonPresent = await homePage.verifyUserProfileButton('Alice Hansen');
        expect(isProfileButtonPresent).toBe(true);
        const userName = await homePage.getUserNameFromProfile();
        expect(userName).toContain('Alice Hansen');
      });
    }
  );
  
  test(
    'Add Nextcloud file storage to Demo project',
    squashTestCase(2064, { stepCount: 6 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const storagesPage = new OpenProjectProjectStoragesPage(page);

      // Prerequisites (Squash): login via Keycloak and ensure admin permissions.
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      const homePage = new OpenProjectHomePage(page);
      await homePage.waitForReady();
      await ensureAliceAdminForCurrentSession(page, homePage);

      let storageAlreadyLinked = false;

      await test.step('Open the project external file storages settings', async () => {
        await storagesPage.navigateToProjectStorages('demo-project');
        await expect(page).toHaveURL(
          openProjectUrl('/projects/demo-project/settings/project_storages/external_file_storages')
        );
        storageAlreadyLinked = await storagesPage.hasNextcloudStorage();
      });

      await test.step('Click on New storage (+Storage)', async () => {
        if (storageAlreadyLinked) {
          await expect(storagesPage.getLocator('nextcloudStorageRow').first()).toBeVisible();
          return;
        }
        await storagesPage.openNewStorageForm();
        await expect(storagesPage.getLocator('addFileStorageHeading').first()).toBeVisible();
      });

      await test.step("Click on Storage field's dropdown", async () => {
        if (storageAlreadyLinked) {
          await expect(storagesPage.getLocator('nextcloudStorageRow').first()).toBeVisible();
          return;
        }
        await storagesPage.openStorageDropdown();
      });

      await test.step('Choose a Nextcloud storage and click Continue', async () => {
        if (storageAlreadyLinked) {
          await expect(storagesPage.getLocator('nextcloudStorageRow').first()).toBeVisible();
          return;
        }
        await storagesPage.selectNextcloudStorageAndContinue();
        await expect(storagesPage.getLocator('automaticFolderModeRadio')).toBeVisible();
      });

      await test.step(
        'Ensure New folder with automatically managed permissions is selected and click Add',
        async () => {
          if (storageAlreadyLinked) {
            await expect(storagesPage.getLocator('nextcloudStorageRow').first()).toBeVisible();
            return;
          }
          await storagesPage.selectAutomaticFolderModeAndAdd();
          await expect(storagesPage.getLocator('nextcloudStorageRow').first()).toBeVisible();
        }
      );

      await test.step('Verify the Nextcloud storage row in the file storages list', async () => {
        if (!(await storagesPage.hasNextcloudStorage())) {
          await storagesPage.navigateToProjectStorages('demo-project');
        }
        await expect(storagesPage.getLocator('nextcloudStorageRow').first()).toContainText(/Nextcloud/i);
      });
    }
  );

  test(
    'Upload a file from OP to NC using ampf',
    squashTestCase(2068, { stepCount: 5 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      await homePage.waitForReady();
      await ensureAliceIsDemoProjectMember();
      await ensureProjectHasNextcloudStorage('demo-project', page);
      await waitForNextcloudStorageHealthy('demo-project');
      await deleteWorkPackageFileLinksByName(2, uploadedFileName);

      await test.step('Open the target work package Files tab', async () => {
        await homePage.navigateToDemoProjectWorkPackageFiles(2);
        await homePage.waitForDemoProjectWorkPackageFilesUrl();
        await homePage.waitForNextcloudFilesSectionConnected(2);
      });

      await test.step(
        'Click Upload files in the Nextcloud section and select a file from the computer',
        async () => {
          await homePage.openFilesPickerWithUpload(uploadedFileName);
          await homePage.waitForFilesPickerReady(uploadedFileName);
          await expect(homePage.getLocator('filesPickerModal')).toBeVisible();
        }
      );

      await test.step('Confirm the upload location (Choose location)', async () => {
        await homePage.confirmFilesPickerOptionalReplace();
      });

      await test.step('Wait for the upload to finish', async () => {
        const uploadSuccessMessage = homePage.getLocator('filesUploadSuccessMessage');
        await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
        await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');
      });

      await test.step(
        'Verify the uploaded file appears in the Nextcloud section of the Files tab',
        async () => {
          const linkedFileItem = homePage.getLinkedWorkPackageFileItem(uploadedFileName);
          await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });
          await expect(linkedFileItem).toContainText(uploadedFileName);
        }
      );
    }
  );

  test(
    'OpenProject Files tab lists linked Nextcloud items and available actions',
    squashTestCase(2148, { stepCount: 4 }),
    async ({ page }) => {
      const workPackageId = 2;
      let homePage = new OpenProjectHomePage(page);

      await test.step('Login to OpenProject as the test user', async () => {
        const loginPage = new OpenProjectLoginPage(page);
        await loginPage.navigateTo();
        const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
        await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

        homePage = new OpenProjectHomePage(page);
        await homePage.waitForReady();
        await ensureAliceIsDemoProjectMember();
      });

      await test.step('Open the target work package', async () => {
        await homePage.navigateToDemoProjectWorkPackage(workPackageId);
        await homePage.waitForDemoProjectWorkPackageUrl();
      });

      await test.step('Open the Files tab', async () => {
        await homePage.openWorkPackageFilesTab();
        await homePage.waitForNextcloudFilesSectionConnected(workPackageId);

        const linkedFileItem = homePage.getLinkedWorkPackageFileItem(uploadedFileName);
        await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(linkedFileItem).toContainText(uploadedFileName);
      });

      await test.step('Hover over a linked file', async () => {
        const linkedFileItem = await homePage.hoverLinkedWorkPackageFile(uploadedFileName);
        await expect(linkedFileItem).toContainText(uploadedFileName);

        const downloadAction = homePage.getLinkedWorkPackageFileDownloadAction(uploadedFileName);
        await expect(downloadAction).toBeVisible();
        await expect(downloadAction).toBeEnabled();

        const openLocationAction =
          homePage.getLinkedWorkPackageFileOpenLocationAction(uploadedFileName);
        await expect(openLocationAction).toBeVisible();
        await expect(openLocationAction).toBeEnabled();

        const removeLinkAction = homePage.getLinkedWorkPackageFileRemoveLinkAction(uploadedFileName);
        await expect(removeLinkAction).toBeVisible();
        await expect(removeLinkAction).toBeEnabled();
      });
    }
  );

  test(
    'File Upload Name Collision - Replace Existing File',
    squashTestCase(2163, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      await homePage.waitForReady();
      await ensureAliceIsDemoProjectMember();
      await ensureProjectHasNextcloudStorage('demo-project', page);
      await waitForNextcloudStorageHealthy('demo-project');
      await cleanupCollisionArtifacts();
      await homePage.navigateToDemoProjectWorkPackageFiles(2);
      await homePage.waitForDemoProjectWorkPackageFilesUrl();
      await homePage.waitForNextcloudFilesSectionConnected(2);
      await homePage.seedAmpfUpload(uploadedFileName);

      await test.step('Open target work package Files tab in OpenProject', async () => {
        await homePage.navigateToDemoProjectWorkPackageFiles(2);
        await homePage.waitForDemoProjectWorkPackageFilesUrl();
        await homePage.waitForNextcloudFilesSectionConnected(2);
        const seedItem = homePage.getLinkedWorkPackageFileItem(uploadedFileName);
        await seedItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(seedItem).toContainText(uploadedFileName);
      });

      await test.step(
        'Click "Upload files" and select a file with an already existing name',
        async () => {
          await homePage.openFilesPickerWithUpload(uploadedFileName, replacedFileBody);
          await homePage.waitForFilesPickerReady(uploadedFileName);
          await expect(homePage.getLocator('filesPickerModal')).toBeVisible();
        }
      );

      await test.step('Confirm upload location', async () => {
        await homePage.confirmFilesPickerExpectingCollision();
      });

      await test.step('Click "Replace"', async () => {
        await homePage.chooseFileCollisionAction('replace');
        await expect(homePage.getLocator('existingFileModalTitle')).toBeHidden({ timeout: 20000 });
        await expect
          .poll(() => homePage.countLinkedWorkPackageFiles(uploadedFileName), { timeout: 15000 })
          .toBe(1);
        await expect
          .poll(
            async () =>
              (await homePage.downloadLinkedWorkPackageFileText(uploadedFileName)).includes(
                'collision-replace-marker'
              ),
            { timeout: 20000 }
          )
          .toBe(true);
      });
    }
  );

  test(
    'File Upload Name Collision - Keep Both Files',
    squashTestCase(2164, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      await loginPage.navigateTo();
      const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
      await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);
      await homePage.waitForReady();
      await ensureAliceIsDemoProjectMember();
      await ensureProjectHasNextcloudStorage('demo-project', page);
      await waitForNextcloudStorageHealthy('demo-project');
      await cleanupCollisionArtifacts();
      await homePage.navigateToDemoProjectWorkPackageFiles(2);
      await homePage.waitForDemoProjectWorkPackageFilesUrl();
      await homePage.waitForNextcloudFilesSectionConnected(2);
      await homePage.seedAmpfUpload(uploadedFileName);

      await test.step('Open target work package Files tab in OpenProject', async () => {
        await homePage.navigateToDemoProjectWorkPackageFiles(2);
        await homePage.waitForDemoProjectWorkPackageFilesUrl();
        await homePage.waitForNextcloudFilesSectionConnected(2);
        const seedItem = homePage.getLinkedWorkPackageFileItem(uploadedFileName);
        await seedItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(seedItem).toContainText(uploadedFileName);
      });

      await test.step(
        'Click "Upload files" and select a file named as an already uploaded',
        async () => {
          await homePage.openFilesPickerWithUpload(uploadedFileName);
          await homePage.waitForFilesPickerReady(uploadedFileName);
          await expect(homePage.getLocator('filesPickerModal')).toBeVisible();
        }
      );

      await test.step('Confirm upload location', async () => {
        await homePage.confirmFilesPickerExpectingCollision();
      });

      await test.step('Click "Keep both"', async () => {
        await homePage.chooseFileCollisionAction('keepBoth');
        const uploadSuccessMessage = homePage.getLocator('filesUploadSuccessMessage');
        await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
        await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');
        const originalItem = homePage.getLinkedWorkPackageFileItem(uploadedFileName);
        await originalItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(originalItem).toContainText(uploadedFileName);
        const siblingItem = homePage.getLinkedWorkPackageFileItemMatching(keepBothSiblingPattern);
        await siblingItem.waitFor({ state: 'visible', timeout: 15000 });
        await expect(siblingItem).toContainText(keepBothSiblingPattern);
      });
    }
  );

  test(
    'Copy AMPF Demo project and verify Nextcloud storage',
    squashTestCase(2161, { stepCount: 5 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      let homePage: OpenProjectHomePage;

      await test.step(
        'Log in to OpenProject via Keycloak as a user with admin permissions',
        async () => {
          await loginPage.navigateTo();
          const keycloakLoginPage = await loginPage.clickKeycloakAuthButton();
          await keycloakLoginPage.loginAsUser(ALICE_USER.username, ALICE_USER.password);

          homePage = new OpenProjectHomePage(page);
          await homePage.waitForReady();
          await ensureAliceAdminForCurrentSession(page, homePage);
        }
      );

      await test.step(
        'Copy the existing project with Nextcloud storage via the UI to a new project',
        async () => {
          await homePage.copyDemoProjectViaUi('test');
        }
      );

      await test.step('Verify redirect to the copied project', async () => {
        await expect(page).toHaveURL(openProjectUrl('/projects/test'));
      });

      await test.step('Open external file storages settings for a copied project', async () => {
        await homePage.navigateToProjectStoragesExternal('test', 30000);
      });

      await test.step('Verify the Nextcloud storage row', async () => {
        const nextcloudStorageRow = homePage.getLocator('nextcloudStorageRow');
        await nextcloudStorageRow.first().waitFor({ state: 'visible', timeout: 15000 });
        await expect(nextcloudStorageRow.first()).toContainText(/Nextcloud/i);
      });
    }
  );

  test.afterAll(async () => {
    await cleanupCollisionArtifacts();

    try {
      const deleted = await deleteProject('test');
      if (deleted) {
        logInfo('[Cleanup] Deleted copied project "test"');
      } else {
        logInfo('[Cleanup] Project "test" not found (already deleted or never created)');
      }
    } catch (err: unknown) {
      logWarn('[Cleanup] Failed to delete project "test":', err);
    }

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
  });

});
