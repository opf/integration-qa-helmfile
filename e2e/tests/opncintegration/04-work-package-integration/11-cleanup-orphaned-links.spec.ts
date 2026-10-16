import { test, expect, dualSetupTags, skipUnlessSetupMethod, isSetupMethod } from '../../base-test';
import { squashTestCase } from '../../../utils/squash-metadata';
import {
  OpenProjectWorkPackageFilesTab,
  OpenProjectFilePickerModal,
} from '../../../pageobjects/openproject';
import {
  createWorkPackage,
  deleteWorkPackage,
  fileLinkExists,
  listWorkPackageFileLinks,
} from '../../../utils/openproject-api';
import {
  deleteNextcloudFile,
  downloadNextcloudFileText,
  seedAmpfFolderWithFile,
} from '../../../utils/nextcloud-api';
import { runCleanupUncontaineredFileLinksJob } from '../../../utils/openproject-oauth-tokens';
import { getErrorMessage } from '../../../utils/error-utils';
import { logInfo, logError } from '../../../utils/logger';
import {
  ampProjectFolder,
  ensureFilesTabNextcloudConnected,
  integrationBrowserUser,
  isOauth2Setup,
  prepareIntegrationUserForDemoStorage,
} from '../shared';

const DEMO_PROJECT = 'demo-project';
const SEED_FOLDER = 'tc-2268';
const SEEDED_FILE = 'orphan-cleanup.md';
const SEEDED_FILE_PATH = `OpenProject/${ampProjectFolder}/${SEED_FOLDER}/${SEEDED_FILE}`;

test.describe('Work Package Integration - Orphaned File Link Cleanup', dualSetupTags, () => {
  test.describe.configure({ timeout: 300_000 });

  let tempWpId: number | undefined;
  let seededFilePath = SEEDED_FILE_PATH;

  test.beforeEach(() => {
    skipUnlessSetupMethod('sso-external', 'oauth2');
  });

  test.afterAll(async () => {
    if (!isSetupMethod('sso-external', 'oauth2')) return;
    const user = integrationBrowserUser();
    if (tempWpId) {
      try {
        await deleteWorkPackage(tempWpId);
      } catch (error: unknown) {
        logInfo('TC-2268', 'afterAll WP cleanup skipped: %s', getErrorMessage(error));
      }
    }
    try {
      await deleteNextcloudFile(seededFilePath, user);
    } catch (error: unknown) {
      logInfo('TC-2268', 'afterAll NC file cleanup skipped: %s', getErrorMessage(error));
    }
  });

  test(
    'Cleanup Orphaned File Links on Work Package Deletion',
    squashTestCase(2268, { stepCount: 5 }),
    async ({ page }) => {
      const filesTab = new OpenProjectWorkPackageFilesTab(page);
      const filePicker = new OpenProjectFilePickerModal(page);
      const user = integrationBrowserUser();
      let fileLinkIds: number[] = [];

      logInfo(
        'TC-2268',
        'Setup: prepare %s (%s) and seed AMPF file',
        user.username,
        isOauth2Setup() ? 'oauth2' : 'sso-external',
      );
      try {
        const { homePage } = await prepareIntegrationUserForDemoStorage(page, {
          openProjectSession: true,
        });
        await homePage.waitForReady();
        await seedAmpfFolderWithFile({
          projectFolder: ampProjectFolder,
          folderName: SEED_FOLDER,
          fileName: SEEDED_FILE,
          user,
          content: `# ${SEEDED_FILE}\nSeeded for orphaned file-link cleanup.\n`,
        });
        seededFilePath = SEEDED_FILE_PATH;
      } catch (error: unknown) {
        logError('TC-2268', 'Setup failed:', getErrorMessage(error));
        throw error;
      }

      await test.step('Create a temporary work package in Demo Project', async () => {
        logInfo('TC-2268', 'Step 1: Creating temporary work package via API');
        const subject = `TC-2268 orphan cleanup ${Date.now()}`;
        const created = await createWorkPackage({
          projectIdentifier: DEMO_PROJECT,
          subject,
        });
        tempWpId = created.id;
        expect(tempWpId).toBeGreaterThan(0);

        await filesTab.navigateToDemoProjectWorkPackage(tempWpId);
        await filesTab.openWorkPackageFilesTabIfNeeded();
        await ensureFilesTabNextcloudConnected(page, filesTab, tempWpId, user);
      });

      await test.step(
        'Link an existing Nextcloud file to the temporary work package',
        async () => {
          logInfo('TC-2268', 'Step 2: Linking %s to WP #%s', SEEDED_FILE, tempWpId);
          await filePicker.openLinkExistingFilesPicker();
          await filePicker.waitForLinkPickerReady();
          await expect(filePicker.getLocator('filesPickerModal')).toBeVisible();
          await filePicker.ensureAtAmpfProjectFolder(ampProjectFolder);

          await filePicker.navigateIntoFolder(SEED_FOLDER);
          await expect(
            filePicker.getLocator('filesPickerBreadcrumb').filter({ hasText: SEED_FOLDER }).first(),
          ).toBeVisible();
          await expect(
            filePicker.getLocator('filesPickerListItem').filter({ hasText: SEEDED_FILE }).first(),
          ).toBeVisible();

          await filePicker.selectFileInPicker(SEEDED_FILE);
          await filePicker.confirmLinkSelection();

          const uploadSuccessMessage = filePicker.getLocator('filesUploadSuccessMessage');
          await uploadSuccessMessage.waitFor({ state: 'visible', timeout: 20000 });
          await expect(uploadSuccessMessage).toContainText('Successfully created 1 file link.');

          const linkedFileItem = filesTab.getLinkedWorkPackageFileItem(SEEDED_FILE);
          await linkedFileItem.waitFor({ state: 'visible', timeout: 15000 });

          const links = await listWorkPackageFileLinks(tempWpId!);
          fileLinkIds = links
            .filter(
              (link) =>
                link.originData?.name === SEEDED_FILE || link._links.self.title === SEEDED_FILE,
            )
            .map((link) => link.id);
          expect(fileLinkIds.length).toBeGreaterThan(0);
        },
      );

      await test.step('Delete the work package in OpenProject', async () => {
        logInfo('TC-2268', 'Step 3: Deleting WP #%s', tempWpId);
        await deleteWorkPackage(tempWpId!);
        tempWpId = undefined;
      });

      await test.step(
        'Trigger or await background orphaned link cleanup job (CleanupUncontaineredFileLinksJob)',
        async () => {
          logInfo('TC-2268', 'Step 4: Running CleanupUncontaineredFileLinksJob');
          await runCleanupUncontaineredFileLinksJob();
        },
      );

      await test.step(
        'Verify file link records are purged in OpenProject while the remote file remains intact in Nextcloud',
        async () => {
          logInfo('TC-2268', 'Step 5: Asserting file links purged and NC file intact');
          for (const id of fileLinkIds) {
            expect(await fileLinkExists(id)).toBe(false);
          }
          const remote = await downloadNextcloudFileText(SEEDED_FILE_PATH, user);
          expect(remote).toContain(SEEDED_FILE);
        },
      );
    },
  );
});
