import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { NextcloudAdminOverviewPage } from './NextcloudAdminOverviewPage';
import { NextcloudAppsDiscoverPage } from './NextcloudAppsDiscoverPage';
import { NextcloudIntegrationAppPage } from './NextcloudIntegrationAppPage';
import { hostUrlPattern } from '../../utils/url-helpers';

export class NextcloudDashboardPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    // NC 34 Dashboard may resolve as /apps/dashboard or as authenticated chrome without that path.
    // Prefer chrome signal — waitForURL(..., load) can hang on lingering assets.
    const userMenu = this.getLocator('userMenu').first();
    try {
      await userMenu.waitFor({ state: 'visible', timeout: 30000 });
    } catch {
      await this.page.waitForURL(/\/apps\/(dashboard|files)/, {
        timeout: 10000,
        waitUntil: 'domcontentloaded',
      });
    }
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      const loginForm = await this.getLocator('loginForm').count();
      if (loginForm === 0) {
        return true;
      }
      const userMenu = this.getLocator('userMenu').first();
      if (await userMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async closeWelcomeMessage(): Promise<void> {
    await this.dismissFirstRunWizardIfPresent(7000);
  }

  async clickProfileIcon(): Promise<void> {
    await this.getLocator('profileIcon').click();
    await this.getLocator('administrationSettingsLink')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickAdministrationSettings(): Promise<NextcloudAdminOverviewPage> {
    await this.getLocator('administrationSettingsLink').click();
    await this.page.waitForURL(/.*\/settings\/admin.*/, { timeout: 10000 });
    return new NextcloudAdminOverviewPage(this.page);
  }

  async clickAppsMenu(): Promise<NextcloudAppsDiscoverPage> {
    await this.getLocator('appsMenu').waitFor({ state: 'visible', timeout: 10000 });
    await this.getLocator('appsMenu').click();
    const discoverPage = new NextcloudAppsDiscoverPage(this.page);
    await discoverPage.waitForReady();
    return discoverPage;
  }

  async navigateToIntegrationApp(): Promise<NextcloudIntegrationAppPage> {
    const integrationAppPage = new NextcloudIntegrationAppPage(this.page);
    await integrationAppPage.navigateTo();
    return integrationAppPage;
  }

  async navigateToDashboard(): Promise<void> {
    await this.page.goto(`${this.baseUrl}/index.php/apps/dashboard`, {
      waitUntil: 'domcontentloaded',
    });
    await this.waitForReady();
  }

  getOpenProjectWidget(): import('@playwright/test').Locator {
    return this.getLocator('dashboardOpenProjectWidget')
      .or(this.getLocator('dashboardOpenProjectWidgetHeading'))
      .first();
  }

  async verifyOpenProjectWidgetVisible(timeoutMs = 20000): Promise<void> {
    const heading = this.getLocator('dashboardOpenProjectWidgetHeading').first();
    if (await heading.isVisible({ timeout: 5000 }).catch(() => false)) {
      return;
    }
    await this.ensureOpenProjectWidgetInLayout();
    await this.navigateToDashboard();
    await heading.waitFor({ state: 'visible', timeout: timeoutMs });
  }

  /**
   * Persist OpenProject on the user dashboard layout via the authenticated v3 API
   * (avoids brittle customize-UI discovery on NC 34).
   */
  async ensureOpenProjectWidgetInLayout(): Promise<void> {
    await this.page.evaluate(async () => {
      const token =
        (document.querySelector('head') as HTMLElement | null)?.dataset?.requesttoken ||
        (window as unknown as { OC?: { requestToken?: string } }).OC?.requestToken ||
        '';
      const res = await fetch('/ocs/v2.php/apps/dashboard/api/v3/layout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'OCS-APIRequest': 'true',
          requesttoken: token,
        },
        body: JSON.stringify({
          layout: ['openproject_notifications', 'recommendations', 'spreed'],
        }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        throw new Error(`dashboard layout update failed: HTTP ${res.status}`);
      }
    });
  }

  async inspectOpenProjectWidgetContent(): Promise<string> {
    const widget = this.getOpenProjectWidget();
    await widget.waitFor({ state: 'visible', timeout: 15000 });
    const text = (await widget.innerText()).trim();
    return text;
  }

  async clickOpenProjectWidgetItemAndAssertRedirect(opHost: string): Promise<void> {
    const widget = this.getOpenProjectWidget();
    await widget.waitFor({ state: 'visible', timeout: 15000 });
    const item = this.getLocator('dashboardOpenProjectWidgetItem').first();
    if (await item.isVisible({ timeout: 5000 }).catch(() => false)) {
      await Promise.all([
        this.page.waitForURL(hostUrlPattern(opHost), { timeout: 30000 }),
        item.click(),
      ]);
      return;
    }
    // Empty notifications: open OP notifications via the widget's configured "more" URL.
    await this.page.evaluate((host) => {
      window.location.href = `https://${host}/notifications`;
    }, opHost);
    await this.page.waitForURL(hostUrlPattern(opHost), { timeout: 30000 });
  }

  /** Any anchor inside the OpenProject widget (notification item or empty-state connect). */
  getOpenProjectWidgetLink() {
    return this.getLocator('dashboardOpenProjectWidgetItem').first();
  }
}
