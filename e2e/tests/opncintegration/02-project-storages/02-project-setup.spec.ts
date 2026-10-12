import { test, expect, openProjectUrl, dualSetupTags, skipUnlessSetupMethod, isSetupMethod } from '../../base-test';
import { OpenProjectProjectListPage } from '../../../pageobjects/openproject';
import { deleteProject, ensureProjectHasNextcloudStorage } from '../../../utils/test-helpers';
import { logInfo, logWarn } from '../../../utils/logger';
import {
  captureAliceAdminStatus,
  dualSetupSquashCase,
  isOauth2Setup,
  loginOpenProjectAsStorageAdmin,
  restoreAliceAdminStatus,
} from '../shared';

const squash = dualSetupSquashCase(
  { id: 2161, title: 'Copy AMPF Demo project and verify Nextcloud storage' },
  { id: 2229, title: '[oauth2] Copy AMPF Demo project and verify Nextcloud storage' },
  5,
);

test.describe('Project Setup', dualSetupTags, () => {
  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });
  // Copy + AMPF folder provisioning needs more than the default 30s.
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    if (!isOauth2Setup()) {
      await captureAliceAdminStatus();
    }
  });

  test(
    squash.title,
    squash.details,
    async ({ page }) => {
      const projectList = new OpenProjectProjectListPage(page);

      let homePage = await test.step(
        'Log in to OpenProject as a user with admin permissions',
        async () => {
          return loginOpenProjectAsStorageAdmin(page);
        }
      );

      // Prerequisite (not a Squash step): demo must already have Nextcloud/AMPF
      // linked so the copy includes file storages. storage-config is a separate TC.
      await ensureProjectHasNextcloudStorage('demo-project', page);

      await test.step(
        'Copy the existing project with Nextcloud storage via the UI to a new project',
        async () => {
          await projectList.copyDemoProjectViaUi('test');
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
    if (!isSetupMethod('sso-external', 'oauth2')) return;
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
    if (!isOauth2Setup()) {
      await restoreAliceAdminStatus();
    }
  });
});
