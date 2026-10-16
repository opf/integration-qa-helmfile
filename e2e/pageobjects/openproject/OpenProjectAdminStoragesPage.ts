import type { Page } from '@playwright/test';
import { NC_ADMIN_USER, OP_ADMIN_USER } from '../../utils/test-users';
import { logDebug, logInfo } from '../../utils/logger';
import { resolveHosts } from '../../utils/env-hosts';
import { hostUrlPattern } from '../../utils/url-helpers';
import { NextcloudLoginPage } from '../nextcloud/NextcloudLoginPage';
import { OpenProjectBasePage } from './OpenProjectBasePage';
import { OpenProjectLoginPage } from './OpenProjectLoginPage';

/**
 * Administration → Files → External file storages (instance-level).
 */
export class OpenProjectAdminStoragesPage extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  async openNextcloudStorage(): Promise<void> {
    const link = this.getLocator('adminStoragesNextcloudLink').first();
    await link.waitFor({ state: 'visible', timeout: 15000 });
    await link.click();
    await this.page.waitForURL(/\/admin\/settings\/storages\/\d+/, { timeout: 15000 });
  }

  async openProjectsTab(): Promise<void> {
    const tab = this.getLocator('adminStoragesProjectsTab').first();
    await tab.waitFor({ state: 'visible', timeout: 15000 });
    await tab.click();
    await this.waitForAdminStorageProjectsUrl();
  }

  projectLinkInTable(projectName: string) {
    return this.getLocator('adminStoragesProjectsTable')
      .getByRole('link', { name: projectName })
      .first();
  }

  async isProjectListed(projectName: string): Promise<boolean> {
    const table = this.getLocator('adminStoragesProjectsTable').first();
    await table.waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
    return this.projectLinkInTable(projectName).isVisible({ timeout: 3000 }).catch(() => false);
  }

  async expectProjectListed(projectName: string): Promise<void> {
    await this.projectLinkInTable(projectName).waitFor({ state: 'visible', timeout: 30000 });
  }

  /**
   * Open Add projects dialog, complete Nextcloud login if required, select project, submit.
   */
  async enableProjectViaAddProjects(projectName: string): Promise<void> {
    if (await this.isProjectListed(projectName)) {
      logInfo('Storage Projects table already lists %s; skipping Add projects', projectName);
      return;
    }

    const addButton = this.getLocator('adminStoragesAddProjectsButton').first();
    await addButton.waitFor({ state: 'visible', timeout: 15000 });
    await addButton.click();

    const dialog = this.getLocator('adminStoragesAddProjectsDialog').first();
    const ncLoginRequired = this.getLocator('adminStoragesNcLoginRequired').first();
    const projectInput = this.getLocator('adminStoragesProjectAutocompleter').first();
    const loginBtn = this.getLocator('adminStoragesNextcloudLogInButton').first();

    // Primer Overlay dialog / spot-modal often report as hidden; wait attached.
    await Promise.race([
      dialog.waitFor({ state: 'attached', timeout: 20000 }),
      ncLoginRequired.waitFor({ state: 'attached', timeout: 20000 }),
      loginBtn.waitFor({ state: 'attached', timeout: 20000 }),
      projectInput.waitFor({ state: 'attached', timeout: 20000 }),
    ]);

    const projectInputReady = await projectInput
      .waitFor({ state: 'attached', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!projectInputReady && (await loginBtn.count()) > 0) {
      await this.completeAddProjectsNextcloudLogin();
      // Dialog copy says log in then try again — reopen Add projects after OAuth.
      await this.page.keyboard.press('Escape').catch(() => undefined);
      await this.waitForAdminStorageProjectsUrl(30000).catch(() => undefined);
      await addButton.waitFor({ state: 'visible', timeout: 15000 });
      await addButton.click();
      await dialog.waitFor({ state: 'attached', timeout: 30000 });
    }

    await this.selectProjectInAddDialog(projectName);

    const automatic = this.getLocator('automaticFolderModeRadio').first();
    if (await automatic.isVisible({ timeout: 5000 }).catch(() => false)) {
      await automatic.check({ force: true }).catch(async () => {
        await automatic.click({ force: true });
      });
    }

    const submit = this.getLocator('adminStoragesAddProjectsSubmit').first();
    await submit.waitFor({ state: 'attached', timeout: 15000 });
    await submit.click({ force: true });

    await this.waitForAdminStorageProjectsUrl(30000);
    await this.expectProjectListed(projectName);
  }

  private async completeAddProjectsNextcloudLogin(): Promise<void> {
    const hosts = resolveHosts();
    const ncHostPattern = hostUrlPattern(hosts.nextcloud);
    const popupPromise = this.page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null);

    const loginBtn = this.getLocator('adminStoragesNextcloudLogInButton').first();
    // Dialog overlay often reports as hidden to Playwright; wait attached + force click.
    await loginBtn.waitFor({ state: 'attached', timeout: 15000 });
    await loginBtn.click({ force: true });

    const popup = await popupPromise;
    const oauthPage = popup ?? this.page;

    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => undefined);
    } else {
      await this.page.waitForURL(ncHostPattern, { timeout: 20000 }).catch(() => undefined);
    }

    const ncLogin = new NextcloudLoginPage(oauthPage);
    await ncLogin.clickOAuthConnectLoginIfPrompted(10000).catch(() => false);
    // Instance admin Add-projects uses NC admin credentials on oauth2 stacks.
    const loggedIn = await ncLogin.loginIfPrompted(
      NC_ADMIN_USER.username,
      NC_ADMIN_USER.password,
      15000,
    );
    logDebug('Add projects Nextcloud login submitted: %s', loggedIn);
    const granted = await ncLogin.grantAccessIfPrompted(20000);
    logDebug('Add projects Nextcloud grant clicked: %s', granted);

    const opLogin = new OpenProjectLoginPage(oauthPage);
    if (popup) {
      await Promise.race([
        oauthPage.waitForURL(hostUrlPattern(hosts.openproject), { timeout: 45000 }),
        oauthPage.waitForEvent('close', { timeout: 45000 }).then(() => null),
      ]).catch(() => null);
      if (!oauthPage.isClosed()) {
        await opLogin.loginIfPrompted(OP_ADMIN_USER.username, OP_ADMIN_USER.password, 5000);
        await opLogin.authorizeOAuthApplicationIfPrompted(20000);
        await oauthPage.waitForEvent('close', { timeout: 30000 }).catch(() => undefined);
      }
    } else {
      await opLogin.loginIfPrompted(OP_ADMIN_USER.username, OP_ADMIN_USER.password, 5000);
      await opLogin.authorizeOAuthApplicationIfPrompted(20000);
      await this.waitForAdminStorageProjectsUrl(30000).catch(() => undefined);
    }
  }

  private async selectProjectInAddDialog(projectName: string): Promise<void> {
    const dialog = this.getLocator('adminStoragesAddProjectsDialog').first();
    await dialog.waitFor({ state: 'attached', timeout: 30000 });

    const selectedToken = this.getLocator('adminStoragesSelectedProjectToken')
      .filter({ hasText: projectName })
      .first();
    if (await selectedToken.isVisible({ timeout: 2000 }).catch(() => false)) {
      logDebug('Add projects dialog already has %s selected', projectName);
      return;
    }

    const input = this.getLocator('adminStoragesProjectAutocompleter').first();
    await input.waitFor({ state: 'attached', timeout: 30000 });
    await input.click({ force: true });
    await input.fill(projectName);

    const option = this.getLocator('adminStoragesProjectOption')
      .filter({ hasText: projectName })
      .first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    await selectedToken.waitFor({ state: 'visible', timeout: 10000 });
  }

  async expectHealthyStatusPill(): Promise<void> {
    const pill = this.getLocator('storageHealthPill').first();
    await pill.waitFor({ state: 'visible', timeout: 15000 });
  }

  async runHealthChecksNow(): Promise<void> {
    const runNow = this.getLocator('storageHealthRunChecksButton').first();
    const openReport = this.getLocator('storageHealthOpenReportLink').first();
    const rerun = this.getLocator('storageHealthRerunChecksButton').first();

    if (await runNow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await runNow.click();
      await this.waitForHealthProbeSettled();
      return;
    }

    // After a prior probe, the sidebar only offers "Open full health report".
    await openReport.waitFor({ state: 'visible', timeout: 15000 });
    await openReport.click();
    await this.page
      .waitForURL(/health|connection_validation|health_status/i, { timeout: 15000 })
      .catch(() => undefined);
    await rerun.waitFor({ state: 'attached', timeout: 20000 });
    const lastCheckBefore = await this.getLocator('storageHealthLastCheckText')
      .first()
      .textContent()
      .catch(() => '');
    await rerun.click({ force: true });
    await this.waitForHealthProbeSettled(lastCheckBefore ?? undefined);
  }

  private async waitForHealthProbeSettled(previousLastCheck?: string): Promise<void> {
    const lastCheck = this.getLocator('storageHealthLastCheckText').first();
    await lastCheck.waitFor({ state: 'visible', timeout: 120000 });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const text = (await lastCheck.textContent().catch(() => '')) ?? '';
      if (!previousLastCheck || text !== previousLastCheck) {
        // Results finished rendering (timestamp advanced or first probe completed).
        return;
      }
      await this.page.waitForTimeout(1000);
    }
    // Probe may finish without changing the displayed second — accept settled UI.
    logInfo('Health probe settle: Last check text unchanged; continuing');
  }

  async expectHealthReportAvailable(): Promise<void> {
    const report = this.getLocator('storageHealthOpenReportLink').first();
    await report.waitFor({ state: 'visible', timeout: 30000 });
  }

  async expectNoUnhealthyNotifications(): Promise<void> {
    const unhealthy = this.getLocator('storageHealthUnhealthyPill').first();
    const errorBanner = this.getLocator('storageHealthErrorBanner').first();
    if (await unhealthy.isVisible({ timeout: 1000 }).catch(() => false)) {
      throw new Error('Unhealthy storage status pill is visible');
    }
    if (await errorBanner.isVisible({ timeout: 1000 }).catch(() => false)) {
      throw new Error('Error banner related to storage health is visible');
    }
  }
}
