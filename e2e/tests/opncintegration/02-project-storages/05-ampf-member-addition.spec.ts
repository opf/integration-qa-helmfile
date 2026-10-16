import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import { NextcloudFilesPage, NextcloudLoginPage } from '../../../pageobjects/nextcloud';
import {
  ensureNextcloudLocalUser,
  waitForAmpfFolderVisibleToUser,
} from '../../../utils/nextcloud-api';
import {
  ensureOpenProjectLocalUser,
  ensureUserIsProjectMember,
} from '../../../utils/openproject-api';
import {
  ensureProjectHasNextcloudStorage,
  ensureUserIsNotProjectMember,
} from '../../../utils/test-helpers';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import { runAutomaticallyManagedStorageSync } from '../../../utils/openproject-oauth-tokens';
import {
  ampProjectFolder,
  isOauth2Setup,
  secondaryIntegrationUser,
} from '../shared';

const DEMO_PROJECT = 'demo-project';

test.describe('AMPF Folder Permission Sync on Member Addition', dualSetupTags, () => {
  test.describe.configure({ timeout: 360_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'AMPF Folder Permission Synchronization on Member Addition',
    squashTestCase(2262, { stepCount: 5 }),
    async ({ page }) => {
      const bob = secondaryIntegrationUser();
      const ncLogin = new NextcloudLoginPage(page);
      const filesPage = new NextcloudFilesPage(page);

      logInfo('TC-2262', 'Setup: provision %s and ensure not a Demo member', bob.username);
      try {
        if (isOauth2Setup()) {
          await ensureOpenProjectLocalUser(bob);
          await ensureNextcloudLocalUser(bob);
        }
        await ensureProjectHasNextcloudStorage(DEMO_PROJECT, undefined);
        await ensureUserIsNotProjectMember(bob.username, DEMO_PROJECT);
        if (bob.email) {
          await ensureUserIsNotProjectMember(bob.email, DEMO_PROJECT).catch(() => undefined);
        }
      } catch (error: unknown) {
        logError('TC-2262', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Identify a secondary test user Bob who is not yet a member of Demo Project',
        async () => {
          logInfo('TC-2262', 'Step 1: Secondary user is %s', bob.username);
          expect(bob.username.length).toBeGreaterThan(0);
        },
      );

      await test.step('In OpenProject, add Bob as Member to Demo Project', async () => {
        logInfo('TC-2262', 'Step 2: Adding %s as Demo Project Member', bob.username);
        const result = await ensureUserIsProjectMember(bob.username, DEMO_PROJECT, 'Member');
        expect(result.userId).toBeGreaterThan(0);
      });

      await test.step(
        'Await background automatically managed storage sync job execution',
        async () => {
          logInfo('TC-2262', 'Step 3: Running AMPF sync job then waiting for folder visibility');
          await runAutomaticallyManagedStorageSync();
          await waitForAmpfFolderVisibleToUser(bob, {
            projectFolder: ampProjectFolder,
            timeoutMs: 180_000,
          });
        },
      );

      await test.step('Log in to Nextcloud as Bob and navigate to Files app', async () => {
        logInfo('TC-2262', 'Step 4: Logging into Nextcloud as %s', bob.username);
        await page.context().clearCookies();
        await ncLogin.login(bob.username, bob.password, {
          redirectPath: '/index.php/apps/files/files',
        });
        await filesPage.waitForReady();
      });

      await test.step(
        'Verify the Demo Project AMPF folder is now visible and accessible to Bob',
        async () => {
          logInfo('TC-2262', 'Step 5: Opening AMPF folder %s', ampProjectFolder);
          await filesPage.openFolder('OpenProject');
          await filesPage.openFolder(ampProjectFolder);
          await filesPage.waitForReady();
        },
      );
    },
  );
});
