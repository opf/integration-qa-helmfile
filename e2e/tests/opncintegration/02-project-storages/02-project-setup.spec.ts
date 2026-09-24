
import { test, expect, openProjectUrl, integrationTags } from '../../base-test';
import { OpenProjectLoginPage, OpenProjectHomePage, OpenProjectProjectListPage } from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { ALICE_USER } from '../../../utils/test-users';
import { deleteProject, ensureProjectHasNextcloudStorage } from '../../../utils/test-helpers';
import { logInfo, logWarn } from '../../../utils/logger';
import { 
  captureAliceAdminStatus, 
  ensureAliceAdminForCurrentSession, 
  restoreAliceAdminStatus 
} from '../shared';

test.describe('Project Setup', integrationTags, () => {
  // Copy + AMPF folder provisioning needs more than the default 30s.
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async () => {
    await captureAliceAdminStatus();
  });

  test(
    'Copy AMPF Demo project and verify Nextcloud storage',
    squashTestCase(2161, { stepCount: 5 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      let homePage: OpenProjectHomePage;
      const projectList = new OpenProjectProjectListPage(page);

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
    await restoreAliceAdminStatus();
  });
});
