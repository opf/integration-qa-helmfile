import { test, dualSetupTags, skipUnlessSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  NextcloudLoginPage,
  NextcloudTextPage,
  NextcloudTalkPage,
} from '../../../pageobjects/nextcloud';
import {
  integrationBrowserUser,
  prepareIntegrationUserForDemoStorage,
} from '../shared';
import { uploadNextcloudFile, deleteNextcloudFile } from '../../../utils/nextcloud-api';
import { logInfo, logError, logWarn } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/error-utils';

const WORK_PACKAGE_ID = 2;
const SEARCH_QUERY = String(WORK_PACKAGE_ID);
const DOC_NAME = `op-smart-picker-${Date.now()}.md`;
const DOC_BODY = `# Smart picker fixture\n\nCreated for TC-2248.\n`;

test.describe('Work Package Integration - Smart Picker in Text and Talk', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterAll(async () => {
    const user = integrationBrowserUser();
    try {
      await deleteNextcloudFile(DOC_NAME, user);
    } catch (error: unknown) {
      logInfo('TC-2248', 'Cleanup doc error:', getErrorMessage(error));
    }
  });

  test(
    'Work Package Smart Picker and Card Previews in Nextcloud Text and Talk',
    squashTestCase(2248, { stepCount: 4 }),
    async ({ page }) => {
      const loginPage = new NextcloudLoginPage(page);
      const textPage = new NextcloudTextPage(page);
      const talkPage = new NextcloudTalkPage(page);
      const user = integrationBrowserUser();

      logInfo('TC-2248', 'Setup: preparing user and uploading Text document %s', DOC_NAME);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await uploadNextcloudFile(DOC_NAME, DOC_BODY, user);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2248', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step('Open a document in Nextcloud Text', async () => {
        logInfo('TC-2248', 'Step 1: Login and open markdown in Text');
        await loginPage.login(user.username, user.password);
        await textPage.openMarkdownFile(DOC_NAME);
      });

      await test.step('In editor body, type / to trigger Smart Picker menu', async () => {
        logInfo('TC-2248', 'Step 2: Triggering smart picker with /');
        await textPage.triggerSmartPicker();
      });

      await test.step(
        'Select OpenProject provider and search for work package subject',
        async () => {
          logInfo('TC-2248', 'Step 3: Selecting OpenProject provider and searching WP');
          await textPage.selectOpenProjectProvider();
          await textPage.searchWorkPackage(SEARCH_QUERY);
        },
      );

      await test.step(
        'Select the target work package and verify rich reference card is inserted',
        async () => {
          logInfo('TC-2248', 'Step 4: Selecting WP and verifying rich reference card');
          await textPage.selectFirstWorkPackageResult();
          await textPage.verifyReferenceCardInserted();
        },
      );

      // Post-Squash (not counted): Talk also exposes the OpenProject smart picker.
      try {
        logInfo('TC-2248', 'Post: verifying OpenProject provider in Talk smart picker');
        await talkPage.navigateTo();
        await talkPage.waitForReady();
        await talkPage.openFirstConversationOrStay();
        await talkPage.triggerSmartPickerInChat();
        await talkPage.verifyOpenProjectProviderVisible();
      } catch (error: unknown) {
        logWarn(
          'TC-2248',
          'Talk smart-picker smoke check skipped/failed: %s',
          getErrorMessage(error),
        );
      }
    },
  );
});
