import { Page } from '@playwright/test';
import { NextcloudBasePage } from './NextcloudBasePage';
import { resolveHostname } from '../../utils/url-helpers';
import { testConfig } from '../../utils/config';

export class NextcloudOpenIDConnectPage extends NextcloudBasePage {
  constructor(page: Page) {
    super(page);
  }

  async navigateTo(): Promise<void> {
    const url = `${this.baseUrl}/settings/admin/user_oidc`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForURL(/.*\/settings\/admin\/user_oidc.*/, { timeout: 10000 });
    await this.dismissWelcomeModalIfPresent();
    await this.getLocator('registeredProvidersText').waitFor({ state: 'visible', timeout: 10000 });
  }

  async dismissWelcomeModalIfPresent(): Promise<void> {
    await this.dismissFirstRunWizardIfPresent(2000);
  }

  private resolveExpectedHostname(envUrl: string | undefined, envHost: string | undefined, fallbackHost: string): string {
    return (
      resolveHostname(envUrl) ||
      resolveHostname(envHost) ||
      resolveHostname(fallbackHost) ||
      fallbackHost
    );
  }

  async verifyKeycloakProviderDetails(): Promise<boolean> {
    try {
      const detailsSection = this.getLocator('keycloakProviderDetails');
      await detailsSection.waitFor({ state: 'visible', timeout: 10000 });
      
      const providerNameLocator = detailsSection.locator('h3');
      const providerName = await providerNameLocator.textContent();
      if (providerName?.trim().toLowerCase() !== 'keycloak') {
        return false;
      }

      const clientIdLabel = detailsSection.locator('label:has-text("Client ID")');
      const clientId = await clientIdLabel.evaluate((el) => {
        const nextSpan = el.nextElementSibling;
        return nextSpan?.tagName === 'SPAN' ? nextSpan.textContent : null;
      });
      if (clientId?.trim() !== 'nextcloud') {
        return false;
      }

      const discoveryLabel = detailsSection.locator('label:has-text("Discovery endpoint")');
      const discoveryEndpoint = await discoveryLabel.evaluate((el) => {
        const nextSpan = el.nextElementSibling;
        return nextSpan?.tagName === 'SPAN' ? nextSpan.textContent : null;
      });
      const keycloakHost = this.resolveExpectedHostname(
        process.env.KEYCLOAK_URL,
        process.env.KEYCLOAK_HOST,
        testConfig.keycloak.host,
      );
      if (!discoveryEndpoint?.includes(`${keycloakHost}/realms/opnc/.well-known/openid-configuration`)) {
        return false;
      }

      const backchannelLabel = detailsSection.locator('label:has-text("Backchannel Logout URL")');
      const backchannelLogoutUrl = await backchannelLabel.evaluate((el) => {
        const nextSpan = el.nextElementSibling;
        return nextSpan?.tagName === 'SPAN' ? nextSpan.textContent : null;
      });
      const nextcloudHost = this.resolveExpectedHostname(
        process.env.NEXTCLOUD_URL,
        process.env.NEXTCLOUD_HOST,
        testConfig.nextcloud.host,
      );
      if (!backchannelLogoutUrl?.includes(`${nextcloudHost}/apps/user_oidc/backchannel-logout/keycloak`)) {
        return false;
      }

      const redirectLabel = detailsSection.locator('label:has-text("Redirect URI")');
      const redirectUri = await redirectLabel.evaluate((el) => {
        const nextSpan = el.nextElementSibling;
        return nextSpan?.tagName === 'SPAN' ? nextSpan.textContent : null;
      });
      if (!redirectUri?.includes(`${nextcloudHost}/apps/user_oidc/code`)) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}
