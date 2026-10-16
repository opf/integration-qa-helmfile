import { test, expect, oauth2Tags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import { OpenProjectAdminStoragesPage, OpenProjectHomePage } from '../../../pageobjects/openproject';
import { getNextcloudStorageOauthClientCredentials } from '../../../utils/openproject-oauth-tokens';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import { loginOpenProjectAsStorageAdmin } from '../shared';

// Numbered 08 (not 05) so alphabetic suite order runs after token refresh/revocation:
// Replace Nextcloud OAuth clears user OAuthClientTokens and would poison 06/07 if run first.
test.describe('OAuth2 Storage Client Credentials Reset', oauth2Tags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('oauth2');
  });

  test(
    'Reset or Replace OAuth Storage Client Credentials in Admin',
    squashTestCase(2257, { stepCount: 3 }),
    async ({ page }) => {
      const adminStorages = new OpenProjectAdminStoragesPage(page);
      let homePage: OpenProjectHomePage;
      let credentials: { clientId: string; clientSecret: string };

      logInfo('TC-2257', 'Setup: admin session + load current NC OAuth credentials');
      try {
        homePage = await loginOpenProjectAsStorageAdmin(page);
        credentials = await getNextcloudStorageOauthClientCredentials();
      } catch (error: unknown) {
        logError('TC-2257', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Navigate to OpenProject Administration -> File storages -> edit Nextcloud storage',
        async () => {
          logInfo('TC-2257', 'Step 1: Opening Nextcloud storage admin edit');
          await homePage.navigateToAdminStoragesSettings();
          await homePage.waitForAdminStoragesSettingsUrl();
          await adminStorages.openNextcloudStorage();
          await expect(adminStorages.getLocator('replaceNextcloudOAuthButton').first()).toBeAttached({
            timeout: 15000,
          });
        },
      );

      await test.step(
        'Re-enter/update the OAuth client ID and client secret, then save',
        async () => {
          logInfo('TC-2257', 'Step 2: Re-entering Nextcloud OAuth client credentials');
          await adminStorages.reenterNextcloudOAuthCredentials(
            credentials.clientId,
            credentials.clientSecret,
          );
        },
      );

      await test.step(
        'Verify storage configuration saves successfully and health check confirms valid connection',
        async () => {
          logInfo('TC-2257', 'Step 3: Running health checks after credentials save');
          await adminStorages.expectHealthyStatusPill();
          await adminStorages.runHealthChecksNow();
          await adminStorages.expectNoUnhealthyNotifications();
          await expect(adminStorages.getLocator('storageHealthUnhealthyPill').first()).toHaveCount(0);
        },
      );
    },
  );
});
