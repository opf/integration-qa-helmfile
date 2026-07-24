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

let aliceWasAdminBeforeSuite = false;
let aliceAdminElevatedBySuite = false;

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
          await expect(storagesPage.getLocator('storageCreationSuccessMessage')).toBeVisible();
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
      const uploadedFileName = 'op-to-nc-upload-test.md';
      const loginPage = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);

      // Prerequisites (Squash): login, membership, healthy AMPF storage, clean prior link.
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
        await homePage.getLocator('filesPickerConfirmButton').click();

        const existingFileModalTitle = homePage.getLocator('existingFileModalTitle');
        if (await existingFileModalTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
          const replaceButton = homePage.getLocator('fileExistsReplaceButton').first();
          await replaceButton.waitFor({ state: 'visible', timeout: 10000 });
          await replaceButton.click();
        }
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
      const uploadedFileName = 'op-to-nc-upload-test.md';
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
    // Clean up test data created during the test suite
    try {
      const deletedLinks = await deleteWorkPackageFileLinksByName(2, 'op-to-nc-upload-test.md');
      logInfo('[Cleanup] Deleted uploaded test file links:', deletedLinks);
    } catch (err) {
      logWarn('[Cleanup] Failed to delete uploaded test file links:', err);
    }

    try {
      await deleteUploadedTestFile(
        'op-to-nc-upload-test.md',
        'Demo project (1)',
        ALICE_USER
      );
      logInfo('[Cleanup] Deleted uploaded test file from Demo project (1)');
    } catch (err) {
      logWarn('[Cleanup] Failed to delete uploaded test file:', err);
    }

    try {
      const deleted = await deleteProject('test');
      if (deleted) {
        logInfo('[Cleanup] Deleted copied project "test"');
      } else {
        logInfo('[Cleanup] Project "test" not found (already deleted or never created)');
      }
    } catch (err) {
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
      } catch (err) {
        logWarn('[Cleanup] Failed to revoke admin permissions from Alice:', err);
      }
    }
  });

});
