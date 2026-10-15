import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
} from '../../../pageobjects/nextcloud';
import {
  integrationBrowserUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';
import { logInfo, logError } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/error-utils';

test.describe('Connection & Auth - Nextcloud Personal OpenProject Settings', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'Nextcloud Personal Settings for OpenProject Preferences',
    squashTestCase(2256, { stepCount: 3 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const personalSettings = new NextcloudPersonalSettingsPage(page);
      const user = integrationBrowserUser();

      logInfo('TC-2256', 'Setup: preparing integration user %s', user.username);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2256', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      let navEnabledAfterToggle = false;
      let searchEnabledAfterToggle = false;
      let navBefore = false;
      let searchBefore = false;

      await test.step(
        'In Nextcloud, navigate to Personal Settings -> OpenProject',
        async () => {
          logInfo('TC-2256', 'Step 1: Login and open personal OpenProject settings');
          await loginPage.login(user.username, user.password, {
            redirectPath: '/index.php/settings/user/openproject',
          });
          await personalSettings.waitForReady();
        },
      );

      try {
        await test.step(
          'Toggle Enable navigation link and Enable unified search for tickets checkboxes',
          async () => {
            logInfo('TC-2256', 'Step 2: Toggling navigation link and unified search');
            navBefore = await personalSettings.isNavigationLinkEnabled();
            searchBefore = await personalSettings.isUnifiedSearchEnabled();
            await personalSettings.toggleNavigationLink(!navBefore);
            await personalSettings.toggleUnifiedSearch(!searchBefore);
            navEnabledAfterToggle = await personalSettings.isNavigationLinkEnabled();
            searchEnabledAfterToggle = await personalSettings.isUnifiedSearchEnabled();
            expect(navEnabledAfterToggle).toBe(!navBefore);
            expect(searchEnabledAfterToggle).toBe(!searchBefore);
          },
        );

        await test.step(
          'Reload page and verify toggled settings persist',
          async () => {
            logInfo('TC-2256', 'Step 3: Reloading and asserting preference persistence');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await personalSettings.waitForReady();
            expect(await personalSettings.isNavigationLinkEnabled()).toBe(navEnabledAfterToggle);
            expect(await personalSettings.isUnifiedSearchEnabled()).toBe(
              searchEnabledAfterToggle,
            );
          },
        );
      } finally {
        // Restore prefs so later dual-setup specs (header link / unified search) are not flaky.
        logInfo('TC-2256', 'Restoring personal OpenProject preferences');
        await personalSettings.toggleNavigationLink(navBefore).catch(() => undefined);
        await personalSettings.toggleUnifiedSearch(searchBefore).catch(() => undefined);
      }
    },
  );
});
