/**
 * Test user credentials for SSO External (Keycloak) integration
 *
 * These users are created automatically in Keycloak when using sso-external setup method.
 * They are defined in charts/opnc-integration/scripts/keycloak.sh
 *
 * Local keeps simple defaults. PullPreview (E2E_ENV=pullpreview) requires secret-backed
 * env vars and fails closed when they are missing.
 */

export interface TestUser {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

const isPullPreview = (): boolean =>
  (process.env.E2E_ENV || process.env.ENV || 'local').toLowerCase() === 'pullpreview';

const envOrDefault = (key: string, fallback: string, roleEnv?: string): string => {
  const direct = process.env[key];
  if (direct && direct.trim().length > 0) {
    return direct;
  }
  if (roleEnv) {
    const role = process.env[roleEnv];
    if (role && role.trim().length > 0) {
      return role;
    }
  }
  if (isPullPreview()) {
    throw new Error(
      `Missing credential env ${key}${roleEnv ? ` (or ${roleEnv})` : ''} for PullPreview; refuse local defaults.`,
    );
  }
  return fallback;
};

/**
 * Admin user credentials (Keycloak admin console)
 * Defaults to admin/admin; overridable via env for hosted environments
 */
export const ADMIN_USER: TestUser = {
  username: envOrDefault('E2E_KC_ADMIN_USER', 'admin'),
  password: envOrDefault('E2E_KC_ADMIN_PASS', 'admin', 'E2E_ADMIN_PASS'),
};

/**
 * OpenProject admin credentials
 */
export const OP_ADMIN_USER: TestUser = {
  username: envOrDefault('E2E_OP_ADMIN_USER', 'admin'),
  password: envOrDefault('E2E_OP_ADMIN_PASS', 'admin', 'E2E_ADMIN_PASS'),
};

/**
 * Nextcloud admin credentials
 */
export const NC_ADMIN_USER: TestUser = {
  username: envOrDefault('E2E_NC_ADMIN_USER', 'admin'),
  password: envOrDefault('E2E_NC_ADMIN_PASS', 'admin', 'E2E_ADMIN_PASS'),
};

/**
 * Alice user - Created in Keycloak realm for SSO External
 * Can be used for OpenProject and Nextcloud via Keycloak SSO
 */
export const ALICE_USER: TestUser = {
  username: envOrDefault('E2E_ALICE_USER', 'alice'),
  password: envOrDefault('E2E_ALICE_PASS', '1234', 'E2E_USER_PASS'),
  firstName: 'Alice',
  lastName: 'Hansen',
  email: 'alice@example.com',
};

/**
 * Brian user - Created in Keycloak realm for SSO External
 * Can be used for OpenProject and Nextcloud via Keycloak SSO
 */
export const BRIAN_USER: TestUser = {
  username: envOrDefault('E2E_BRIAN_USER', 'brian'),
  password: envOrDefault('E2E_BRIAN_PASS', '1234', 'E2E_USER_PASS'),
  firstName: 'Brian',
  lastName: 'Murphy',
  email: 'brian@example.com',
};

/**
 * Oliver Oauth — local (non-SSO) user for SETUP_METHOD=oauth2 flows.
 * Provisioned via OpenProject API + Nextcloud OCS (not Keycloak).
 * Display name: "Oliver Oauth".
 */
export const OLIVER_OAUTH_USER: TestUser = {
  username: envOrDefault('E2E_OLIVER_USER', 'oliver'),
  password: envOrDefault('E2E_OLIVER_PASS', 'OliverOauth-1234!', 'E2E_USER_PASS'),
  firstName: 'Oliver',
  lastName: 'Oauth',
  email: envOrDefault('E2E_OLIVER_EMAIL', 'oliver@example.com'),
};

/**
 * Password/name defaults for TC 2227 Files-tab authorize.
 * Spec invents a unique username per run so OP→NC starts unauthorized (no token revoke).
 */
export const FILES_AUTH_OAUTH_USER: TestUser = {
  username: envOrDefault('E2E_FILES_AUTH_USER', 'oliver-files-auth'),
  password: envOrDefault('E2E_FILES_AUTH_PASS', 'OliverFilesAuth-1234!', 'E2E_USER_PASS'),
  firstName: 'Oliver',
  lastName: 'FilesAuth',
  email: envOrDefault('E2E_FILES_AUTH_EMAIL', 'oliver-files-auth@example.com'),
};

/**
 * Bob Oauth — secondary local user for AMPF member-sync / permission-boundary (oauth2).
 * Provisioned via OpenProject API + Nextcloud OCS (not Keycloak).
 */
export const BOB_OAUTH_USER: TestUser = {
  username: envOrDefault('E2E_BOB_USER', 'bob'),
  password: envOrDefault('E2E_BOB_PASS', 'BobOauth-1234!', 'E2E_USER_PASS'),
  firstName: 'Bob',
  lastName: 'Oauth',
  email: envOrDefault('E2E_BOB_EMAIL', 'bob@example.com'),
};
