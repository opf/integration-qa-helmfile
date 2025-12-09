/**
 * Test user credentials for SSO External (Keycloak) integration
 * 
 * These users are created automatically in Keycloak when using sso-external setup method.
 * They are defined in charts/opnc-integration/scripts/keycloak.sh
 * 
 * These users can be used for OpenProject and Nextcloud authentication via Keycloak SSO.
 */

export interface TestUser {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

const envOrDefault = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : fallback;
};

/**
 * Admin user credentials (Keycloak admin console)
 * Defaults to admin/admin; overridable via env for hosted environments
 */
export const ADMIN_USER: TestUser = {
  username: envOrDefault('E2E_KC_ADMIN_USER', 'admin'),
  password: envOrDefault('E2E_KC_ADMIN_PASS', 'admin'),
};

/**
 * OpenProject admin credentials
 */
export const OP_ADMIN_USER: TestUser = {
  username: envOrDefault('E2E_OP_ADMIN_USER', 'admin'),
  password: envOrDefault('E2E_OP_ADMIN_PASS', 'admin'),
};

/**
 * Nextcloud admin credentials
 */
export const NC_ADMIN_USER: TestUser = {
  username: envOrDefault('E2E_NC_ADMIN_USER', 'admin'),
  password: envOrDefault('E2E_NC_ADMIN_PASS', 'admin'),
};

/**
 * Alice user - Created in Keycloak realm for SSO External
 * Can be used for OpenProject and Nextcloud via Keycloak SSO
 */
export const ALICE_USER: TestUser = {
  username: envOrDefault('E2E_ALICE_USER', 'alice'),
  password: envOrDefault('E2E_ALICE_PASS', '1234'),
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
  password: envOrDefault('E2E_BRIAN_PASS', '1234'),
  firstName: 'Brian',
  lastName: 'Murphy',
  email: 'brian@example.com',
};

/**
 * Get all test users available for SSO External (Keycloak)
 */
export function getSSOExternalUsers(): TestUser[] {
  return [ALICE_USER, BRIAN_USER];
}

/**
 * Get a test user by username
 */
export function getUserByUsername(username: string): TestUser | undefined {
  const allUsers = [ADMIN_USER, ALICE_USER, BRIAN_USER];
  return allUsers.find(user => user.username === username);
}

