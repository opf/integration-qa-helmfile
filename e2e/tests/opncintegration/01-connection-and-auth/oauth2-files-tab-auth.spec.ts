import { Page } from '@playwright/test';
import { test, expect, oauth2Tags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  OpenProjectLoginPage,
  OpenProjectWorkPackageFilesTab,
} from '../../../pageobjects/openproject';
import { FILES_AUTH_OAUTH_USER, type TestUser } from '../../../utils/test-users';
import { ensureNextcloudLocalUser } from '../../../utils/nextcloud-api';
import {
  ensureOpenProjectLocalUser,
  ensureUserIsProjectMember,
} from '../../../utils/openproject-api';
import { ensureProjectHasNextcloudStorage } from '../../../utils/test-helpers';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import { resolveHosts } from '../../../utils/env-hosts';
import { hostUrlPattern } from '../../../utils/url-helpers';
import {
  grantNextcloudOAuthFromFilesTab,
  openNextcloudOAuthFromFilesTab,
} from '../shared';

const WORK_PACKAGE_ID = 2;
const DEMO_PROJECT = 'demo-project';

/** Fresh local user each run so Files shows Login without Access-token revoke. */
function freshFilesAuthUser(): TestUser {
  const suffix = `${Date.now()}`.slice(-8);
  return {
    ...FILES_AUTH_OAUTH_USER,
    username: `fa-${suffix}`,
    email: `fa-${suffix}@example.com`,
  };
}

test.describe('Connection & Auth - OAuth2 Files Tab Authorization', oauth2Tags, () => {
  test.describe.configure({ timeout: 300_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('oauth2');
  });

  test(
    '[oauth2] Authorize Nextcloud connection from OpenProject Files tab',
    squashTestCase(2227, { stepCount: 4 }),
    async ({ page }) => {
      const opLoginPage = new OpenProjectLoginPage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const hosts = resolveHosts();
      const user = freshFilesAuthUser();
      let oauthPage: Page = page;

      // Prerequisites: never-authorized OP→NC user (no revoke / NC disconnect).
      logInfo('TC-2227', 'Setup: provisioning %s and Demo storage', user.username);
      try {
        await Promise.all([
          ensureOpenProjectLocalUser(user),
          ensureNextcloudLocalUser(user),
        ]);
        await ensureUserIsProjectMember(user.username, DEMO_PROJECT, 'Member');
        await ensureProjectHasNextcloudStorage(DEMO_PROJECT, undefined);
      } catch (error: unknown) {
        logError('TC-2227', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Log in to OpenProject as the test user and navigate to a work package',
        async () => {
          logInfo('TC-2227', 'Step 1: Logging in as %s and opening WP #%s', user.username, WORK_PACKAGE_ID);
          const home = await opLoginPage.login(user.username, user.password);
          await home.waitForReady();
          await filesTab.navigateToDemoProjectWorkPackage(WORK_PACKAGE_ID);
          await filesTab.waitForDemoProjectWorkPackageUrl();
        },
      );

      await test.step('Open the Files tab', async () => {
        logInfo('TC-2227', 'Step 2: Opening Files tab and waiting for Nextcloud login prompt');
        await filesTab.openWorkPackageFilesTab();
        await filesTab.waitForNextcloudLoginPrompt(60000);
        await expect(filesTab.getStorageLoginPromptLocator()).toBeVisible();
        await expect(filesTab.getNextcloudLoginButtonLocator()).toBeVisible();
      });

      await test.step('Click "Nextcloud login" button', async () => {
        logInfo('TC-2227', 'Step 3: Clicking Nextcloud login to start storage OAuth');
        oauthPage = await openNextcloudOAuthFromFilesTab(page, filesTab);
        await expect(oauthPage).toHaveURL(hostUrlPattern(hosts.nextcloud), { timeout: 20000 });
      });

      await test.step('Authorize access in Nextcloud and return to OpenProject', async () => {
        logInfo('TC-2227', 'Step 4: Granting Nextcloud access and verifying Files tab connected');
        await grantNextcloudOAuthFromFilesTab(page, oauthPage, filesTab, WORK_PACKAGE_ID, user);
        const linkExisting = filesTab.getLocator('linkExistingFilesButton').first();
        await expect(linkExisting).toBeVisible({ timeout: 30000 });
        await filesTab.waitForNextcloudFilesSectionConnected(WORK_PACKAGE_ID);
      });
    },
  );
});
