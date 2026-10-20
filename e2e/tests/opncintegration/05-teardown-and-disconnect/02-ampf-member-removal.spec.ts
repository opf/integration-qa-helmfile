import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import { NextcloudFilesPage, NextcloudLoginPage } from '../../../pageobjects/nextcloud';
import {
  waitForAmpfFolderHiddenFromUser,
  waitForAmpfFolderVisibleToUser,
} from '../../../utils/nextcloud-api';
import { ensureUserIsProjectMember } from '../../../utils/openproject-api';
import {
  ensureProjectHasNextcloudStorage,
  ensureUserIsNotProjectMember,
} from '../../../utils/test-helpers';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import { runAutomaticallyManagedStorageSync } from '../../../utils/openproject-oauth-tokens';
import {
  ampProjectFolder,
  ensureSecondaryIntegrationUserProvisioned,
  secondaryIntegrationUser,
} from '../shared';

const DEMO_PROJECT = 'demo-project';

test.describe('AMPF Folder Permission Sync on Member Removal', dualSetupTags, () => {
  test.describe.configure({ timeout: 360_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'AMPF Folder Permission Revocation on Member Removal',
    squashTestCase(2270, { stepCount: 3 }),
    async ({ page }) => {
      const bob = secondaryIntegrationUser();
      const ncLogin = new NextcloudLoginPage(page);
      const filesPage = new NextcloudFilesPage(page);

      logInfo(
        'TC-2270',
        'Setup: ensure %s is Demo member with AMPF folder visible',
        bob.username,
      );
      try {
        await ensureSecondaryIntegrationUserProvisioned(page);
        await ensureProjectHasNextcloudStorage(DEMO_PROJECT, undefined);
        await ensureUserIsProjectMember(bob.username, DEMO_PROJECT, 'Member');
        await runAutomaticallyManagedStorageSync();
        await waitForAmpfFolderVisibleToUser(bob, {
          projectFolder: ampProjectFolder,
          timeoutMs: 180_000,
        });
      } catch (error: unknown) {
        logError('TC-2270', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'In OpenProject, remove test user Bob from Demo Project membership',
        async () => {
          logInfo('TC-2270', 'Step 1: Removing %s from Demo Project', bob.username);
          const result = await ensureUserIsNotProjectMember(bob.username, DEMO_PROJECT);
          expect(result.userId).toBeGreaterThan(0);
          expect(result.removed).toBe(true);
          if (bob.email) {
            await ensureUserIsNotProjectMember(bob.email, DEMO_PROJECT).catch(() => undefined);
          }
        },
      );

      await test.step(
        'Await background automatically managed storage sync job execution',
        async () => {
          logInfo('TC-2270', 'Step 2: Running AMPF sync then waiting for folder hidden');
          await runAutomaticallyManagedStorageSync();
          await waitForAmpfFolderHiddenFromUser(bob, {
            projectFolder: ampProjectFolder,
            timeoutMs: 180_000,
          });
        },
      );

      await test.step(
        'Log in to Nextcloud as Bob and verify the Demo Project AMPF folder is no longer visible or accessible',
        async () => {
          logInfo('TC-2270', 'Step 3: Verifying AMPF folder hidden in NC UI for %s', bob.username);
          await page.context().clearCookies();
          await ncLogin.login(bob.username, bob.password, {
            redirectPath: '/index.php/apps/files/files',
          });
          await filesPage.waitForReady();

          const openProjectRow = filesPage.getFileRow('OpenProject');
          const openProjectVisible = await openProjectRow
            .isVisible({ timeout: 5000 })
            .catch(() => false);
          if (!openProjectVisible) {
            await expect(openProjectRow).toBeHidden();
            return;
          }

          await filesPage.openFolder('OpenProject');
          await filesPage.waitForReady();
          await expect(filesPage.getFileRow(ampProjectFolder)).toBeHidden({ timeout: 15000 });
        },
      );
    },
  );
});
