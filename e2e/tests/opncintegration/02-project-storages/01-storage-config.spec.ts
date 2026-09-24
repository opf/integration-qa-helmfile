
import { test, expect, integrationTags, openProjectUrl } from '../../base-test';
import { testConfig } from '../../../utils/config';
import { ensureAliceAdminForCurrentSession } from '../shared';
import { OpenProjectLoginPage, OpenProjectHomePage, OpenProjectProjectStoragesPage } from '../../../pageobjects/openproject';
import { squashTestCase } from '../../../utils/squash-metadata';
import { ALICE_USER } from '../../../utils/test-users';
import { ensureUserIsAdmin, ensureUserIsProjectMember } from '../../../utils/test-helpers';

test.describe('Storage Configuration', integrationTags, () => {
  test(
    'Add Nextcloud file storage to Demo project',
    squashTestCase(2064, { stepCount: 6 }),
    async ({ page }) => {
      const loginPage = new OpenProjectLoginPage(page);
      const storagesPage = new OpenProjectProjectStoragesPage(page);

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
});
