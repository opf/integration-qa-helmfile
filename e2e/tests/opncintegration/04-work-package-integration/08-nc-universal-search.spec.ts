import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudPersonalSettingsPage,
  NextcloudHeaderPage,
  NextcloudFilesPage,
} from '../../../pageobjects/nextcloud';
import {
  integrationBrowserUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';
import { logInfo, logError } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/error-utils';

const WORK_PACKAGE_ID = 2;
/** Short term — longer phrases can leave NC unified search stuck on "Searching...". */
const SEARCH_QUERY = String(WORK_PACKAGE_ID);

test.describe('Work Package Integration - Nextcloud Universal Search', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'Universal Search for OpenProject Work Packages in Nextcloud Header',
    squashTestCase(2249, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const personalSettings = new NextcloudPersonalSettingsPage(page);
      const header = new NextcloudHeaderPage(page);
      const filesPage = new NextcloudFilesPage(page);
      const user = integrationBrowserUser();

      logInfo('TC-2249', 'Setup: preparing integration user %s', user.username);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2249', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step(
        'Ensure Enable unified search for tickets is enabled in personal settings',
        async () => {
          logInfo('TC-2249', 'Step 1: Enabling unified search preference');
          await loginPage.login(user.username, user.password, {
            redirectPath: '/index.php/settings/user/openproject',
          });
          await personalSettings.waitForReady();
          await personalSettings.toggleUnifiedSearch(true);
          expect(await personalSettings.isUnifiedSearchEnabled()).toBe(true);
          // Provider registration is read on page load.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await personalSettings.waitForReady();
          expect(await personalSettings.isUnifiedSearchEnabled()).toBe(true);
        },
      );

      await test.step('Click the Nextcloud header search icon', async () => {
        logInfo('TC-2249', 'Step 2: Opening unified search');
        await filesPage.navigateToFiles();
        await filesPage.waitForReady();
        await header.openUnifiedSearch();
      });

      await test.step('Type search query for existing work package', async () => {
        logInfo('TC-2249', 'Step 3: Searching for work package %s', SEARCH_QUERY);
        await header.searchUnified(SEARCH_QUERY);
      });

      await test.step(
        'Verify OpenProject search result group appears and clicking result redirects to OpenProject',
        async () => {
          logInfo('TC-2249', 'Step 4: Asserting OP search group and redirect');
          await header.verifyOpenProjectSearchGroupVisible();
          await header.clickFirstOpenProjectSearchResultAndAssertRedirect();
        },
      );
    },
  );
});
