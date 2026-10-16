import { test, expect, dualSetupTags, skipUnlessSetupMethod, isSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  OpenProjectAdminStoragesPage,
  OpenProjectHomePage,
  OpenProjectProjectStoragesPage,
  OpenProjectWorkPackageFilesTab,
} from '../../../pageobjects/openproject';
import {
  captureAliceAdminStatus,
  isOauth2Setup,
  loginOpenProjectAsStorageAdmin,
  restoreAliceAdminStatus,
} from '../shared';
import { isProjectNextcloudStorageLinked } from '../../../utils/test-helpers';
import { logInfo } from '../../../utils/logger';

/** Seeded Scrum demo project — has work packages and no Nextcloud storage by default. */
const ADDITIONAL_PROJECT_IDENTIFIER = 'your-scrum-project';
const ADDITIONAL_PROJECT_NAME = 'Scrum project';
const SCRUM_WORK_PACKAGE_ID = 15;

test.describe('Instance Storage Multi-Project Enable', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.beforeAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    if (!isOauth2Setup()) {
      await captureAliceAdminStatus();
    }
  });

  test.afterAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    if (!isOauth2Setup()) {
      await restoreAliceAdminStatus();
    }
  });

  test(
    'Enable Storage across Multiple Projects at Instance Level',
    squashTestCase(2259, { stepCount: 5 }),
    async ({ page }) => {
      const adminStorages = new OpenProjectAdminStoragesPage(page);
      const projectStorages = new OpenProjectProjectStoragesPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      let homePage: OpenProjectHomePage;

      const alreadyLinked = await isProjectNextcloudStorageLinked(ADDITIONAL_PROJECT_IDENTIFIER);

      await test.step('Log in as Admin and navigate to Administration -> File storages', async () => {
        homePage = await loginOpenProjectAsStorageAdmin(page);
        await homePage.navigateToAdminStoragesSettings();
        await homePage.waitForAdminStoragesSettingsUrl();
        await expect(adminStorages.getLocator('adminStoragesNextcloudLink').first()).toBeVisible();
      });

      await test.step(
        'Open the Nextcloud storage and navigate to Projects tab',
        async () => {
          await adminStorages.openNextcloudStorage();
          await adminStorages.openProjectsTab();
          await expect(adminStorages.getLocator('adminStoragesAddProjectsButton').first()).toBeVisible();
        },
      );

      await test.step('Enable the storage for an additional project', async () => {
        if (alreadyLinked) {
          logInfo(
            'Project %s already has Nextcloud storage; asserting Projects table listing',
            ADDITIONAL_PROJECT_IDENTIFIER,
          );
          await adminStorages.expectProjectListed(ADDITIONAL_PROJECT_NAME);
          return;
        }
        await adminStorages.enableProjectViaAddProjects(ADDITIONAL_PROJECT_NAME);
        await adminStorages.expectProjectListed(ADDITIONAL_PROJECT_NAME);
      });

      await test.step(
        'Navigate to the project storage settings of the added project and verify storage is active',
        async () => {
          await projectStorages.navigateToProjectStorages(ADDITIONAL_PROJECT_IDENTIFIER);
          await expect(projectStorages.getLocator('nextcloudStorageRow').first()).toBeVisible({
            timeout: 30000,
          });
          await expect(projectStorages.getLocator('nextcloudStorageRow').first()).toContainText(
            /Nextcloud/i,
          );
        },
      );

      await test.step(
        'Open a work package in the project and verify Files tab displays the Nextcloud storage',
        async () => {
          await filesTab.navigateToProjectWorkPackageFiles(
            ADDITIONAL_PROJECT_IDENTIFIER,
            SCRUM_WORK_PACKAGE_ID,
          );
          await filesTab.openWorkPackageFilesTabIfNeeded();
          const dropBox = filesTab.getLocator('workPackageFilesUploadDropBox').first();
          const linkExisting = filesTab.getLocator('linkExistingFilesButton').first();
          const ncLogin = filesTab.getNextcloudLoginButtonLocator();
          await expect
            .poll(
              async () => {
                if (await dropBox.isVisible().catch(() => false)) return 'drop';
                if (await linkExisting.isVisible().catch(() => false)) return 'link';
                if (await ncLogin.isVisible().catch(() => false)) return 'login';
                return null;
              },
              { timeout: 45000 },
            )
            .not.toBeNull();
        },
      );
    },
  );
});
