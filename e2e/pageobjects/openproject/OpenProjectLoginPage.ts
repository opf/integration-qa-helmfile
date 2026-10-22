import { expect, Page } from '@playwright/test';
import { OpenProjectBasePage } from './OpenProjectBasePage';
import { KeycloakLoginPage } from '../keycloak/KeycloakLoginPage';
import { OpenProjectHomePage } from './OpenProjectHomePage';
import { OP_ADMIN_USER } from '../../utils/test-users';
import { testConfig } from '../../utils/config';
import { resolveHosts } from '../../utils/env-hosts';
import { escapeForRegex, resolveHostname } from '../../utils/url-helpers';

const keycloakHost =
  resolveHostname(process.env.KEYCLOAK_URL) ||
  resolveHostname(process.env.KEYCLOAK_HOST) ||
  resolveHostname(testConfig.keycloak.host) ||
  'keycloak.test';
const keycloakHostPattern = new RegExp(`.*${escapeForRegex(keycloakHost)}.*`);

function openProjectHost(): string {
  return (
    resolveHostname(resolveHosts().openproject) ||
    resolveHostname(testConfig.openproject.host) ||
    resolveHosts().openproject
  );
}

export class OpenProjectLoginPage extends OpenProjectBasePage {
  constructor(page: Page) {
    super(page);
  }

  async waitForReady(): Promise<void> {
    // Wait for the page to be stable first
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    // Then wait for the sign in heading to be visible
    await this.getLocator('signInText').waitFor({ state: 'visible', timeout: 10000 });
  }

  async fillUsername(username: string): Promise<void> {
    // Prefer #username on the main login form (avoids header pulldown duplicate fields).
    const byId = this.getLocator('usernameInputById').first();
    if (await byId.isVisible().catch(() => false)) {
      await byId.fill(username);
      return;
    }
    await this.getLocator('usernameInput').fill(username);
  }

  async fillPassword(password: string): Promise<void> {
    const byId = this.getLocator('passwordInputById').first();
    if (await byId.isVisible().catch(() => false)) {
      await byId.fill(password);
      return;
    }
    await this.getLocator('passwordInput').fill(password);
  }

  async clickSignIn(): Promise<void> {
    // Fresh first-login users can leave EnjoyHint on /login after clearCookies()
    // (storage survives); dismiss before Sign in or the overlay intercepts the click.
    await new OpenProjectHomePage(this.page).dismissTutorialOverlayIfPresent();
    await this.getLocator('loginButton').first().click();
  }

  async login(username: string = OP_ADMIN_USER.username, password: string = OP_ADMIN_USER.password): Promise<OpenProjectHomePage> {
    await this.navigateTo();
    await this.waitForReady();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.getLocator('usernameInputById').first().waitFor({ state: 'visible', timeout: 5000 });
    await this.fillUsername(username);
    await this.fillPassword(password);
    await this.clickSignIn();
    await this.waitForOpenProjectUrl();
    return new OpenProjectHomePage(this.page);
  }

  /**
   * Start Keycloak auth from the OP login page.
   * With an existing Keycloak SSO cookie (e.g. after NC OIDC login), OP may bounce
   * straight back to the app without settling on the Keycloak host — that is OK.
   */
  async clickKeycloakAuthButton(): Promise<KeycloakLoginPage> {
    // If we've already been redirected to Keycloak (e.g., auto-SSO), skip looking for the OP button.
    if (keycloakHostPattern.test(this.page.url())) {
      const keycloakPage = new KeycloakLoginPage(this.page);
      await keycloakPage.waitForReady().catch(() => {});
      return keycloakPage;
    }

    // Try the known locator first, but fall back to a direct /auth/keycloak visit
    const primary = this.getLocator('keycloakAuthButton').first();
    const fallbackLocator = this.page.locator(
      "a[href*='/auth/keycloak'], button.auth-provider-keycloak, a.auth-provider-keycloak, button:has-text('Keycloak'), a:has-text('Keycloak')"
    ).first();

    const candidate = await Promise.race([
      primary.waitFor({ state: 'attached', timeout: 10000 }).then(() => primary).catch(() => null),
      fallbackLocator.waitFor({ state: 'attached', timeout: 10000 }).then(() => fallbackLocator).catch(() => null),
    ]);

    if (candidate) {
      const href = await candidate.getAttribute('href');
      if (href) {
        await this.page.goto(new URL(href, this.page.url()).toString());
      } else {
        await candidate.click({ timeout: 5000 });
      }
    } else {
      const keycloakUrl = new URL('/auth/keycloak', this.page.url()).toString();
      await this.page.goto(keycloakUrl);
    }

    const opHost = escapeForRegex(openProjectHost());
    // SSO bounce: Keycloak cookie → back on OP without a Keycloak login form.
    await Promise.race([
      this.page.waitForURL(keycloakHostPattern, { timeout: 15000 }),
      this.page.waitForURL(
        (url) => {
          const href = typeof url === 'string' ? url : url.href;
          return (
            new RegExp(opHost).test(href) &&
            !href.includes('/login') &&
            !href.includes('/auth/keycloak')
          );
        },
        { timeout: 15000 },
      ),
    ]);

    const keycloakPage = new KeycloakLoginPage(this.page);
    if (keycloakHostPattern.test(this.page.url())) {
      await keycloakPage.waitForReady().catch(() => {});
    }
    return keycloakPage;
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

  /**
   * On the OpenProject OAuth authorize screen, click Authorize/Allow if present.
   * No-op when already authorized / redirected away.
   */
  async authorizeOAuthApplicationIfPrompted(timeoutMs = 15000): Promise<boolean> {
    const authorize = this.getLocator('oauthAuthorizeButton').first();
    const allow = this.getLocator('oauthAllowButton').first();
    const submit = this.getLocator('oauthAuthorizeSubmit').first();
    const opHost =
      resolveHostname(resolveHosts().openproject) || resolveHosts().openproject;
    if (!this.page.url().includes(opHost)) {
      return false;
    }

    let found: typeof authorize | null = null;
    try {
      await expect
        .poll(
          async () => {
            if (!this.page.url().includes(opHost)) return 'left';
            for (const candidate of [authorize, allow, submit]) {
              if (await candidate.isVisible().catch(() => false)) {
                found = candidate;
                return 'button';
              }
            }
            return null;
          },
          { timeout: timeoutMs },
        )
        .toMatch(/^(button|left)$/);
    } catch {
      return false;
    }
    if (!found || !this.page.url().includes(opHost)) {
      return false;
    }
    await found.click();
    return true;
  }

  /**
   * If the OpenProject login form is visible, sign in with the given credentials.
   * Preserves OAuth back_url (does not navigate away from the current authorize redirect).
   * On sso-external, non-admin users go through Keycloak (local OP password is invalid).
   * Returns true when a login was performed (including SSO bounce with an existing KC session).
   */
  async loginIfPrompted(username: string, password: string, timeoutMs = 8000): Promise<boolean> {
    // Only treat a real login page as a prompt — Activity/WP pages must not force Keycloak.
    const onLoginUrl = this.page.url().includes('/login');
    const signIn = this.getLocator('signInText').first();
    if (!onLoginUrl) {
      const arrived = await Promise.race([
        this.page
          .waitForURL((url) => {
            const href = typeof url === 'string' ? url : url.href;
            return href.includes('/login');
          }, { timeout: timeoutMs })
          .then(() => true),
        signIn.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true),
      ]).catch(() => false);
      if (!arrived) {
        return false;
      }
    }

    const usernameInput = this.getLocator('usernameInputById').first();
    const keycloakBtn = this.getLocator('keycloakAuthButton').first();
    const visible = await Promise.race([
      usernameInput.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true),
      keycloakBtn.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true),
      signIn.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true),
    ]).catch(() => false);
    if (!visible) {
      return false;
    }

    const useKeycloak =
      testConfig.setupMethod !== 'oauth2' && username !== OP_ADMIN_USER.username;
    if (useKeycloak) {
      await this.clickKeycloakAuthButton();
      // Existing Keycloak SSO cookie may bounce straight back to OP — no credentials needed.
      if (keycloakHostPattern.test(this.page.url())) {
        const keycloak = new KeycloakLoginPage(this.page);
        await keycloak.loginAsUser(username, password);
      }
    } else {
      await this.fillUsername(username);
      await this.fillPassword(password);
      await this.clickSignIn();
    }
    // After sign-in we either land on /oauth/authorize or leave /login entirely.
    await this.page
      .waitForURL((url) => !url.pathname.includes('/login') || url.pathname.includes('/oauth/'), {
        timeout: 20000,
      })
      .catch(() => undefined);
    return true;
  }
}

