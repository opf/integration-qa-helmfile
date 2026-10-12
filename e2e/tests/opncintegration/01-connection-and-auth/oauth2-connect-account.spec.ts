import { test, expect, oauth2Tags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
} from '../../../pageobjects/nextcloud';
import { OpenProjectLoginPage } from '../../../pageobjects/openproject';
import { OLIVER_OAUTH_USER } from '../../../utils/test-users';
import { ensureNextcloudLocalUser } from '../../../utils/nextcloud-api';
import { ensureOpenProjectLocalUser } from '../../../utils/openproject-api';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import { resolveHosts } from '../../../utils/env-hosts';
import { hostUrlPattern } from '../../../utils/url-helpers';

test.describe('Connection & Auth - OAuth2 Account Connection', oauth2Tags, () => {
  test.describe.configure({ timeout: 300_000 });
  test.beforeEach(() => {
    skipUnlessSetupMethod('oauth2');
  });

  test(
    '[oauth2] Connect Nextcloud Account from Nextcloud User Settings',
    squashTestCase(2226, { stepCount: 4 }),
    async ({ page }) => {

      const ncLoginPage = new NextcloudLoginPage(page);
      const personalSettingsPage = new NextcloudPersonalSettingsPage(page);
      const opLoginPage = new OpenProjectLoginPage(page);

      // Prerequisites: ensure user accounts exist in OpenProject and Nextcloud
      logInfo('TC-2226', 'Prerequisites: ensuring Oliver local user exists');
      try {
        await Promise.all([
          ensureOpenProjectLocalUser(OLIVER_OAUTH_USER),
          ensureNextcloudLocalUser(OLIVER_OAUTH_USER),
        ]);
      } catch (error: unknown) {
        logError('TC-2226', 'Prerequisites failed:', getErrorMessage(error));
        throw error;
      }

      await test.step('Log in to Nextcloud as the test user', async () => {
        logInfo('TC-2226', 'Step 1: Logging in to Nextcloud as Oliver Oauth');
        const dashboard = await ncLoginPage.login(
          OLIVER_OAUTH_USER.username,
          OLIVER_OAUTH_USER.password,
        );
        expect(await dashboard.isLoggedIn()).toBe(true);
      });

      await test.step('Navigate to Settings -> OpenProject', async () => {
        logInfo('TC-2226', 'Step 2: Navigating to Nextcloud Settings → OpenProject');
        await personalSettingsPage.navigateTo();
        await personalSettingsPage.waitForReady();

        // Short probe: when already disconnected, avoid burning ~3s waiting for Disconnect.
        if (await personalSettingsPage.isConnected(500)) {
          logInfo(
            'TC-2226',
            'Oliver is currently connected; disconnecting first for fresh test run',
          );
          await personalSettingsPage.disconnectOpenProject();
        }

        await expect(
          personalSettingsPage.getLocator('ncPersonalSettingsConnectButton').first(),
        ).toBeVisible();
      });

      await test.step(
        'Click "Connect to OpenProject" button and authorize access in OpenProject OAuth prompt',
        async () => {
          logInfo('TC-2226', 'Step 3: Clicking Connect to OpenProject and authorizing OAuth');
          // Wizard already dismissed during login.
          await personalSettingsPage.clickConnectToOpenProject(0);
          const hosts = resolveHosts();
          await page.waitForURL(hostUrlPattern(hosts.openproject), { timeout: 20000 });

          const loggedIn = await opLoginPage.loginIfPrompted(
            OLIVER_OAUTH_USER.username,
            OLIVER_OAUTH_USER.password,
            15000,
          );
          logInfo('TC-2226', `OpenProject login prompted during OAuth: ${loggedIn}`);
          if (page.url().includes('/login')) {
            throw new Error(
              `Still on OpenProject login after Connect OAuth redirect: ${page.url()}`,
            );
          }

          const authorized = await opLoginPage.authorizeOAuthApplicationIfPrompted(20000);
          logInfo('TC-2226', `OpenProject OAuth authorize clicked: ${authorized}`);

          await page.waitForURL(
            hostUrlPattern(hosts.nextcloud, 'settings\\/user\\/openproject'),
            { timeout: 45000 },
          );
        },
      );

      await test.step('Verify connection status in Nextcloud user settings', async () => {
        logInfo('TC-2226', 'Step 4: Verifying connected status in Nextcloud user settings');
        await personalSettingsPage.waitForReady();
        await personalSettingsPage.waitForConnected(30000);
        expect(await personalSettingsPage.isConnected()).toBe(true);
        await expect(
          personalSettingsPage.getLocator('ncPersonalSettingsDisconnectButton').first(),
        ).toBeVisible();
      });
    },
  );
});
