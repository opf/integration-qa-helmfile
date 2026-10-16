import { test, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  OpenProjectHomePage,
  OpenProjectLoginPage,
  OpenProjectWorkPackageFilesTab,
} from '../../../pageobjects/openproject';
import { ensureNextcloudLocalUser } from '../../../utils/nextcloud-api';
import {
  ensureOpenProjectLocalUser,
  ensureUserIsProjectMember,
} from '../../../utils/openproject-api';
import { revokeAmpfAccessByStrippingFilePermissions } from '../../../utils/openproject-oauth-tokens';
import { ensureProjectHasNextcloudStorage } from '../../../utils/test-helpers';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import {
  DEMO_WORK_PACKAGE_ID,
  ensureFilesTabNextcloudConnected,
  isOauth2Setup,
  secondaryIntegrationUser,
} from '../shared';

const DEMO_PROJECT = 'demo-project';

test.describe('Permission Boundary Enforcement in Files Tab', dualSetupTags, () => {
  test.describe.configure({ timeout: 360_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'Permission Boundary Enforcement in Files Tab (User Without Nextcloud Permission)',
    squashTestCase(2266, { stepCount: 4 }),
    async ({ page }) => {
      const user = secondaryIntegrationUser();
      const opLogin = new OpenProjectLoginPage(page);
      const homePage = new OpenProjectHomePage(page);
      const filesTab = new OpenProjectWorkPackageFilesTab(page);

      async function loginAsRestrictedUser(): Promise<void> {
        if (isOauth2Setup()) {
          await opLogin.login(user.username, user.password);
        } else {
          await opLogin.navigateTo();
          const keycloak = await opLogin.clickKeycloakAuthButton();
          await keycloak.loginAsUser(user.username, user.password);
        }
        await homePage.waitForReady();
      }

      logInfo(
        'TC-2266',
        'Setup: %s as OP member with Files OAuth, then strip file perms + AMPF sync',
        user.username,
      );
      try {
        if (isOauth2Setup()) {
          await ensureOpenProjectLocalUser(user);
          await ensureNextcloudLocalUser(user);
        }
        await ensureProjectHasNextcloudStorage(DEMO_PROJECT, undefined);
        await ensureUserIsProjectMember(user.username, DEMO_PROJECT, 'Member');
        await loginAsRestrictedUser();
        await filesTab.navigateToDemoProjectWorkPackage(DEMO_WORK_PACKAGE_ID);
        await filesTab.openWorkPackageFilesTabIfNeeded();
        await ensureFilesTabNextcloudConnected(page, filesTab, DEMO_WORK_PACKAGE_ID, user);
        // AMPF re-grants NC ACL for Member+read_files; strip OP file perms then sync.
        await revokeAmpfAccessByStrippingFilePermissions(user.username, DEMO_PROJECT);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2266', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Log in as a user who has OP work package access but lacks Nextcloud folder permissions',
        async () => {
          logInfo('TC-2266', 'Step 1: Logging in as %s', user.username);
          await loginAsRestrictedUser();
        },
      );

      await test.step('Navigate to target work package Files tab', async () => {
        logInfo('TC-2266', 'Step 2: Opening Demo WP #%s Files tab', DEMO_WORK_PACKAGE_ID);
        await filesTab.navigateToDemoProjectWorkPackageFiles(DEMO_WORK_PACKAGE_ID);
        await filesTab.openWorkPackageFilesTabIfNeeded();
      });

      await test.step(
        'Verify permission boundary notice or access-restricted indicator is displayed',
        async () => {
          logInfo('TC-2266', 'Step 3: Asserting Nextcloud upload/link actions are hidden');
          await filesTab.verifyAccessRestrictedNotice(30000);
        },
      );

      await test.step(
        'Verify user is prevented from uploading or deleting files in the restricted folder',
        async () => {
          logInfo('TC-2266', 'Step 4: Asserting upload is blocked under restriction');
          await filesTab.expectUploadRestricted();
        },
      );
    },
  );
});
