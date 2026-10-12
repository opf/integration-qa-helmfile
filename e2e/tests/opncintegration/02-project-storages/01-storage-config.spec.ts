import { test, expect, dualSetupTags, skipUnlessSetupMethod, openProjectUrl } from '../../base-test';
import { loginOpenProjectAsStorageAdmin, dualSetupSquashCase } from '../shared';
import { OpenProjectProjectStoragesPage } from '../../../pageobjects/openproject';

const squash = dualSetupSquashCase(
  { id: 2064, title: 'Add Nextcloud file storage to Demo project' },
  { id: 2228, title: '[oauth2] Activate file storage (Nextcloud) in a project' },
  6,
);

test.describe('Storage Configuration', dualSetupTags, () => {
  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });
  test(
    squash.title,
    squash.details,
    async ({ page }) => {
      const storagesPage = new OpenProjectProjectStoragesPage(page);

      await loginOpenProjectAsStorageAdmin(page);

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
