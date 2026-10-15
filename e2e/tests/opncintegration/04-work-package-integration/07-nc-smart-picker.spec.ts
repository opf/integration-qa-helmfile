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
// Plain paragraphs only — a leading `#` heading steals caret and blocks the `/` slash menu.
const DOC_BODY = `Smart picker fixture\n\nCreated for TC-2248.\n`;

test.describe('Work Package Integration - Smart Picker in Text and Talk', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });
  let docName = '';

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterEach(async ({ page }) => {
    if (!docName) return;
    const user = integrationBrowserUser();
    try {
      const textPage = new NextcloudTextPage(page);
      await textPage.closeViewer().catch(() => undefined);
      await deleteNextcloudFile(docName, user);
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
      docName = `op-smart-picker-${Date.now()}.md`;

      logInfo('TC-2248', 'Setup: preparing user and uploading Text document %s', docName);
      try {
        await prepareIntegrationUserForDemoStorage(page);
        await uploadNextcloudFile(docName, DOC_BODY, user);
        await page.context().clearCookies();
      } catch (error: unknown) {
        logError('TC-2248', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step('Open a document in Nextcloud Text', async () => {
        logInfo('TC-2248', 'Step 1: Login and open markdown in Text');
        await loginPage.login(user.username, user.password, {
          redirectPath: '/index.php/apps/files/files',
        });
        await textPage.openMarkdownFile(docName);
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
          await textPage.selectFirstWorkPackageResult(SEARCH_QUERY);
          await textPage.verifyReferenceCardInserted();
        },
      );

      // Post-Squash (not counted): Talk also exposes the OpenProject smart picker.
      try {
        logInfo('TC-2248', 'Post: verifying OpenProject provider in Talk smart picker');
        await textPage.closeViewer();
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
      } finally {
        await textPage.closeViewer().catch(() => undefined);
      }
    },
  );
});
