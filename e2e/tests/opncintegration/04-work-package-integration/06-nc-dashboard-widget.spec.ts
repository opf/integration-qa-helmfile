import { test, expect, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudDashboardPage,
} from '../../../pageobjects/nextcloud';
import {
  integrationBrowserUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';
import { resolveHosts } from '../../../utils/env-hosts';
import { logInfo, logError } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/error-utils';

test.describe('Work Package Integration - Nextcloud Dashboard OpenProject Widget', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test(
    'OpenProject Notifications & Assigned WPs Widget on Nextcloud Dashboard',
    squashTestCase(2247, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const dashboard = new NextcloudDashboardPage(page);
      const user = integrationBrowserUser();
      const opHost = resolveHosts().openproject;

      logInfo('TC-2247', 'Setup: preparing integration user %s', user.username);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2247', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step('Navigate to Nextcloud Dashboard', async () => {
        logInfo('TC-2247', 'Step 1: Login and open Nextcloud dashboard');
        await loginPage.login(user.username, user.password);
        await dashboard.navigateToDashboard();
        await dashboard.closeWelcomeMessage();
      });

      await test.step('Verify OpenProject widget is visible on dashboard', async () => {
        logInfo('TC-2247', 'Step 2: Verifying OpenProject dashboard widget');
        await dashboard.verifyOpenProjectWidgetVisible(30000);
      });

      await test.step('Inspect the OpenProject widget content', async () => {
        logInfo('TC-2247', 'Step 3: Inspecting widget content');
        const content = await dashboard.inspectOpenProjectWidgetContent();
        expect(content.length).toBeGreaterThan(0);
        logInfo('TC-2247', 'Widget content preview: %s', content.slice(0, 120));
      });

      await test.step(
        'Click a work package card link and verify redirection to OpenProject',
        async () => {
          logInfo('TC-2247', 'Step 4: Clicking widget item toward OpenProject');
          await dashboard.clickOpenProjectWidgetItemAndAssertRedirect(opHost);
          expect(page.url()).toContain(opHost);
        },
      );
    },
  );
});
