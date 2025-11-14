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

/**
 * Admin user credentials (Keycloak admin console)
 * Default admin/admin credentials for Keycloak
 */
export const ADMIN_USER: TestUser = {
  username: 'admin',
  password: 'admin',
};

/**
 * Alice user - Created in Keycloak realm for SSO External
 * Can be used for OpenProject and Nextcloud via Keycloak SSO
 */
export const ALICE_USER: TestUser = {
  username: 'alice',
  password: '1234',
  firstName: 'Alice',
  lastName: 'Hansen',
  email: 'alice@example.com',
};

/**
 * Brian user - Created in Keycloak realm for SSO External
 * Can be used for OpenProject and Nextcloud via Keycloak SSO
 */
export const BRIAN_USER: TestUser = {
  username: 'brian',
  password: '1234',
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

