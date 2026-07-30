import { ADMIN_USER } from './test-users';
import { getErrorMessage } from './error-utils';
import { resolveEnvName, resolveHosts } from './env-hosts';
import { getDispatcher } from './tls-dispatcher';
import { logInfo, logWarn } from './logger';
import type { TestUser } from './test-users';

const KC_REALM = process.env.E2E_KC_REALM || 'opnc';
const KC_NC_CLIENT_ID = process.env.E2E_KC_NC_CLIENT_ID || 'nextcloud';
const KC_NC_CLIENT_SECRET = process.env.E2E_KC_NC_CLIENT_SECRET || 'nextcloud-secret';

interface KeycloakTokenResponse {
  access_token?: string;
}

interface KeycloakClient {
  id?: string;
  clientId?: string;
  directAccessGrantsEnabled?: boolean;
}

interface NextcloudUserResponse {
  ocs?: {
    data?: {
      id?: string | number;
      userid?: string | number;
      'display-name'?: string;
    };
  };
}

async function getKeycloakAdminToken(kcHost: string): Promise<string> {
  const dispatcher = getDispatcher();
  const response = await fetch(
    `https://${kcHost}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: ADMIN_USER.username,
        password: ADMIN_USER.password,
      }).toString(),
      ...(dispatcher ? { dispatcher } : {}),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Keycloak admin token failed: HTTP ${response.status} ${response.statusText} - ${text}`
    );
  }
  const data = (await response.json()) as KeycloakTokenResponse;
  if (!data.access_token) {
    throw new Error('Keycloak token response missing access_token');
  }
  return data.access_token;
}

async function ensureDirectAccessGrants(
  kcHost: string,
  kcAdminToken: string
): Promise<void> {
  const dispatcher = getDispatcher();
  const clientsResponse = await fetch(
    `https://${kcHost}/admin/realms/${KC_REALM}/clients?clientId=${encodeURIComponent(KC_NC_CLIENT_ID)}`,
    {
      headers: { authorization: `Bearer ${kcAdminToken}` },
      ...(dispatcher ? { dispatcher } : {}),
    }
  );
  if (!clientsResponse.ok) {
    throw new Error(
      `Keycloak list clients failed: HTTP ${clientsResponse.status} ${clientsResponse.statusText}`
    );
  }
  const clients = (await clientsResponse.json()) as KeycloakClient[];
  const ncClient = clients.find((c) => c.clientId === KC_NC_CLIENT_ID);
  if (!ncClient?.id) {
    throw new Error(
      `Keycloak client '${KC_NC_CLIENT_ID}' not found in realm '${KC_REALM}'`
    );
  }
  if (ncClient.directAccessGrantsEnabled === true) {
    return;
  }
  const fullResponse = await fetch(
    `https://${kcHost}/admin/realms/${KC_REALM}/clients/${ncClient.id}`,
    {
      headers: { authorization: `Bearer ${kcAdminToken}` },
      ...(dispatcher ? { dispatcher } : {}),
    }
  );
  if (!fullResponse.ok) {
    throw new Error(
      `Keycloak get client failed: HTTP ${fullResponse.status} ${fullResponse.statusText}`
    );
  }
  const fullClient = (await fullResponse.json()) as Record<string, unknown>;
  fullClient.directAccessGrantsEnabled = true;
  const putResponse = await fetch(
    `https://${kcHost}/admin/realms/${KC_REALM}/clients/${ncClient.id}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${kcAdminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(fullClient),
      ...(dispatcher ? { dispatcher } : {}),
    }
  );
  if (!putResponse.ok) {
    const text = await putResponse.text();
    logWarn(
      `Failed to enable direct access grants on Keycloak client: HTTP ${putResponse.status} - ${text}`
    );
    throw new Error(
      `Failed to enable direct access grants: HTTP ${putResponse.status}`
    );
  }
}

async function getKeycloakTokenForUser(
  kcHost: string,
  user: TestUser
): Promise<string> {
  const dispatcher = getDispatcher();
  const response = await fetch(
    `https://${kcHost}/realms/${KC_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: KC_NC_CLIENT_ID,
        client_secret: KC_NC_CLIENT_SECRET,
        username: user.username,
        password: user.password,
      }).toString(),
      ...(dispatcher ? { dispatcher } : {}),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Keycloak token for user ${user.username} failed: HTTP ${response.status} ${response.statusText} - ${text}`
    );
  }
  const data = (await response.json()) as KeycloakTokenResponse;
  if (!data.access_token) {
    throw new Error('Keycloak token response missing access_token');
  }
  return data.access_token;
}

function extractNextcloudUserId(data: NextcloudUserResponse): string | undefined {
  const raw = data.ocs?.data?.id ?? data.ocs?.data?.userid;
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  return String(raw);
}

/**
 * Resolve the WebDAV path user segment for a Nextcloud account.
 * Prefer OCS /cloud/user id; fall back to the Keycloak/test username when OCS
 * omits id (common with OIDC bearer tokens that still authenticate WebDAV).
 */
async function resolveNextcloudUserId(
  ncHost: string,
  bearerToken: string,
  fallbackUsername: string
): Promise<string> {
  const dispatcher = getDispatcher();
  const response = await fetch(
    `https://${ncHost}/ocs/v1.php/cloud/user?format=json`,
    {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        'OCS-APIRequest': 'true',
        accept: 'application/json',
      },
      ...(dispatcher ? { dispatcher } : {}),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    logWarn(
      'Nextcloud user resolution failed (HTTP %s); falling back to username %s: %s',
      response.status,
      fallbackUsername,
      text
    );
    return fallbackUsername;
  }

  let data: NextcloudUserResponse;
  try {
    data = (await response.json()) as NextcloudUserResponse;
  } catch (error: unknown) {
    logWarn(
      'Nextcloud user response was not JSON; falling back to username %s: %s',
      fallbackUsername,
      getErrorMessage(error)
    );
    return fallbackUsername;
  }

  const userId = extractNextcloudUserId(data);
  if (userId) {
    return userId;
  }

  logWarn(
    'Nextcloud user response missing id/userid; falling back to username %s',
    fallbackUsername
  );
  return fallbackUsername;
}

function encodeWebDavPath(segment: string): string {
  return encodeURIComponent(segment).replace(/!/g, '%21');
}

async function fileExists(
  ncHost: string,
  userId: string,
  filePath: string,
  bearerToken: string
): Promise<boolean> {
  const dispatcher = getDispatcher();
  const encodedPath = filePath
    .split('/')
    .filter(Boolean)
    .map(encodeWebDavPath)
    .join('/');
  const url = `https://${ncHost}/remote.php/dav/files/${encodeURIComponent(userId)}/${encodedPath}`;
  const response = await fetch(url, {
    method: 'HEAD',
    headers: { authorization: `Bearer ${bearerToken}` },
    ...(dispatcher ? { dispatcher } : {}),
  });
  return response.ok;
}

async function deleteFile(
  ncHost: string,
  userId: string,
  filePath: string,
  bearerToken: string
): Promise<void> {
  const dispatcher = getDispatcher();
  const encodedPath = filePath
    .split('/')
    .filter(Boolean)
    .map(encodeWebDavPath)
    .join('/');
  const url = `https://${ncHost}/remote.php/dav/files/${encodeURIComponent(userId)}/${encodedPath}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${bearerToken}` },
    ...(dispatcher ? { dispatcher } : {}),
  });
  if (response.status !== 204 && response.status !== 404) {
    const text = await response.text();
    throw new Error(
      `Nextcloud WebDAV DELETE failed: HTTP ${response.status} ${response.statusText} - ${text}`
    );
  }
}

/**
 * Ensure direct access grants are enabled on the Keycloak nextcloud client.
 * This allows password-based token requests (ROPC flow) for Nextcloud users.
 * Should be called once during test setup (e.g. in global-setup.ts).
 */
export async function ensureKeycloakDirectAccessForNextcloud(): Promise<void> {
  const hosts = resolveHosts(resolveEnvName());
  const kcHost = hosts.keycloak;
  const adminToken = await getKeycloakAdminToken(kcHost);
  await ensureDirectAccessGrants(kcHost, adminToken);
}

/**
 * Delete a file in a user's Nextcloud WebDAV space.
 * Uses Keycloak OIDC token (requires directAccessGrantsEnabled on the nextcloud client).
 * Checks if file exists before attempting deletion to reduce error spam.
 */
export async function deleteNextcloudFile(
  filePath: string,
  user: TestUser
): Promise<void> {
  const hosts = resolveHosts(resolveEnvName());
  const kcHost = hosts.keycloak;
  const ncHost = hosts.nextcloud;

  const bearerToken = await getKeycloakTokenForUser(kcHost, user);
  const userId = await resolveNextcloudUserId(ncHost, bearerToken, user.username);

  // Check if file exists before attempting deletion (idempotency check)
  const exists = await fileExists(ncHost, userId, filePath, bearerToken);
  if (!exists) {
    logInfo('File not found (already deleted or never existed): %s', filePath);
    return;
  }
  
  await deleteFile(ncHost, userId, filePath, bearerToken);
}
