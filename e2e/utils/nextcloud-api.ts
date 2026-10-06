import { ADMIN_USER } from './test-users';
import { getErrorMessage } from './error-utils';
import { resolveEnvName, resolveHosts } from './env-hosts';
import { tlsFetch } from './tls-dispatcher';
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
    meta?: {
      status?: string;
      statuscode?: number;
    };
    data?: {
      id?: string | number;
      userid?: string | number;
      'display-name'?: string;
    };
  };
}

async function getKeycloakAdminToken(kcHost: string): Promise<string> {
  const response = await tlsFetch(
    `https://${kcHost}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: ADMIN_USER.username,
        password: ADMIN_USER.password
      }).toString()
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
  const clientsResponse = await tlsFetch(
    `https://${kcHost}/admin/realms/${KC_REALM}/clients?clientId=${encodeURIComponent(KC_NC_CLIENT_ID)}`,
    {
      headers: { authorization: `Bearer ${kcAdminToken}` }
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
  const fullResponse = await tlsFetch(
    `https://${kcHost}/admin/realms/${KC_REALM}/clients/${ncClient.id}`,
    {
      headers: { authorization: `Bearer ${kcAdminToken}` }
    }
  );
  if (!fullResponse.ok) {
    throw new Error(
      `Keycloak get client failed: HTTP ${fullResponse.status} ${fullResponse.statusText}`
    );
  }
  const fullClient = (await fullResponse.json()) as Record<string, unknown>;
  fullClient.directAccessGrantsEnabled = true;
  const putResponse = await tlsFetch(
    `https://${kcHost}/admin/realms/${KC_REALM}/clients/${ncClient.id}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${kcAdminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(fullClient)
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
  const response = await tlsFetch(
    `https://${kcHost}/realms/${KC_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: KC_NC_CLIENT_ID,
        client_secret: KC_NC_CLIENT_SECRET,
        username: user.username,
        password: user.password
      }).toString()
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
 * Prefer OCS /cloud/user id (OIDC users are often hashed ids, not Keycloak usernames).
 * Retries briefly: OCS can lag right after first SSO login.
 */
async function resolveNextcloudUserId(
  ncHost: string,
  bearerToken: string,
  fallbackUsername: string
): Promise<string> {
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await tlsFetch(
      `https://${ncHost}/ocs/v1.php/cloud/user?format=json`,
      {
        headers: {
          authorization: `Bearer ${bearerToken}`,
          'OCS-APIRequest': 'true',
          accept: 'application/json'
        }
      }
    );
    if (!response.ok) {
      const text = await response.text();
      logWarn(
        'Nextcloud user resolution failed (HTTP %s) attempt %s/%s: %s',
        response.status,
        attempt,
        maxAttempts,
        text
      );
    } else {
      try {
        const data = (await response.json()) as NextcloudUserResponse;
        const statusCode = data.ocs?.meta?.statuscode;
        const userId = extractNextcloudUserId(data);
        if (userId && (statusCode === undefined || statusCode === 100)) {
          return userId;
        }
        logWarn(
          'Nextcloud user response missing id (ocs statuscode=%s) attempt %s/%s',
          statusCode,
          attempt,
          maxAttempts
        );
      } catch (error: unknown) {
        logWarn(
          'Nextcloud user response was not JSON attempt %s/%s: %s',
          attempt,
          maxAttempts,
          getErrorMessage(error)
        );
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  logWarn(
    'Nextcloud user resolution exhausted retries; falling back to username %s',
    fallbackUsername
  );
  return fallbackUsername;
}

function encodeWebDavPath(segment: string): string {
  return encodeURIComponent(segment).replace(/!/g, '%21');
}

function buildWebDavUrl(ncHost: string, userId: string, filePath: string): string {
  const encodedPath = filePath
    .split('/')
    .filter(Boolean)
    .map(encodeWebDavPath)
    .join('/');
  return `https://${ncHost}/remote.php/dav/files/${encodeURIComponent(userId)}/${encodedPath}`;
}

async function withWebDavAuth(
  user: TestUser
): Promise<{ ncHost: string; userId: string; bearerToken: string }> {
  const hosts = resolveHosts(resolveEnvName());
  const bearerToken = await getKeycloakTokenForUser(hosts.keycloak, user);
  const userId = await resolveNextcloudUserId(hosts.nextcloud, bearerToken, user.username);
  return { ncHost: hosts.nextcloud, userId, bearerToken };
}

async function fileExists(
  ncHost: string,
  userId: string,
  filePath: string,
  bearerToken: string
): Promise<boolean> {
  const response = await tlsFetch(buildWebDavUrl(ncHost, userId, filePath), {
    method: 'HEAD',
    headers: { authorization: `Bearer ${bearerToken}` }
  });
  return response.ok;
}

async function deleteFile(
  ncHost: string,
  userId: string,
  filePath: string,
  bearerToken: string
): Promise<void> {
  const response = await tlsFetch(buildWebDavUrl(ncHost, userId, filePath), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${bearerToken}` }
  });
  if (response.status !== 204 && response.status !== 404) {
    const text = await response.text();
    throw new Error(
      `Nextcloud WebDAV DELETE failed: HTTP ${response.status} ${response.statusText} - ${text}`
    );
  }
}

async function createFolder(
  ncHost: string,
  userId: string,
  folderPath: string,
  bearerToken: string
): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await tlsFetch(buildWebDavUrl(ncHost, userId, folderPath), {
      method: 'MKCOL',
      headers: { authorization: `Bearer ${bearerToken}` }
    });
    // 201 created; 405 already exists (WebDAV)
    if (response.status === 201 || response.status === 405 || response.status === 301) {
      return;
    }
    if (response.status === 409 && (await fileExists(ncHost, userId, folderPath, bearerToken))) {
      return;
    }
    // Transient Nextcloud lock / startup races
    if ((response.status === 503 || response.status === 502) && attempt < maxAttempts) {
      const text = await response.text();
      logWarn(
        'Nextcloud WebDAV MKCOL transient HTTP %s for %s (attempt %s/%s): %s',
        response.status,
        folderPath,
        attempt,
        maxAttempts,
        text.slice(0, 200)
      );
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      continue;
    }
    const text = await response.text();
    throw new Error(
      `Nextcloud WebDAV MKCOL failed for '${folderPath}': HTTP ${response.status} ${response.statusText} - ${text}`
    );
  }
}

async function putFile(
  ncHost: string,
  userId: string,
  filePath: string,
  content: string | Buffer,
  bearerToken: string
): Promise<void> {
  const body =
    typeof content === 'string' ? content : new Uint8Array(content);
  const response = await tlsFetch(buildWebDavUrl(ncHost, userId, filePath), {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${bearerToken}`,
      'content-type': 'text/markdown',
    },
    body: body as import('undici').RequestInit['body'],
  });
  if (response.status !== 201 && response.status !== 204) {
    const text = await response.text();
    throw new Error(
      `Nextcloud WebDAV PUT failed for '${filePath}': HTTP ${response.status} ${response.statusText} - ${text}`
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
  const { ncHost, userId, bearerToken } = await withWebDavAuth(user);

  // Check if file exists before attempting deletion (idempotency check)
  const exists = await fileExists(ncHost, userId, filePath, bearerToken);
  if (!exists) {
    logInfo('File not found (already deleted or never existed): %s', filePath);
    return;
  }

  await deleteFile(ncHost, userId, filePath, bearerToken);
}

/**
 * Ensure a WebDAV folder exists (idempotent MKCOL).
 * Path is relative to the user's files root, e.g. `OpenProject/Demo project (1)/R&D`.
 */
export async function ensureNextcloudFolder(
  folderPath: string,
  user: TestUser
): Promise<void> {
  const { ncHost, userId, bearerToken } = await withWebDavAuth(user);
  if (await fileExists(ncHost, userId, folderPath, bearerToken)) {
    logInfo('Nextcloud folder already exists: %s', folderPath);
    return;
  }
  await createFolder(ncHost, userId, folderPath, bearerToken);
  logInfo('Created Nextcloud folder: %s', folderPath);
}

/**
 * Upload (create or overwrite) a file via WebDAV PUT.
 * Path is relative to the user's files root.
 */
export async function uploadNextcloudFile(
  filePath: string,
  content: string | Buffer,
  user: TestUser
): Promise<void> {
  const { ncHost, userId, bearerToken } = await withWebDavAuth(user);
  await putFile(ncHost, userId, filePath, content, bearerToken);
  logInfo('Uploaded Nextcloud file: %s', filePath);
}

export interface SeedAmpfFolderWithFileOptions {
  projectFolder: string;
  folderName: string;
  fileName: string;
  user: TestUser;
  content?: string | Buffer;
}

/**
 * Idempotently seed `OpenProject/<projectFolder>/<folderName>/<fileName>` via WebDAV.
 * Leaves the folder and file in place for re-runs (no UI folder creation).
 * Retries when AMPF ACLs / groupfolders mounts lag after project-folder provisioning.
 */
export async function seedAmpfFolderWithFile(
  options: SeedAmpfFolderWithFileOptions
): Promise<void> {
  const {
    projectFolder,
    folderName,
    fileName,
    user,
    content = `# ${fileName}\nSeeded for E2E file-picker navigation.\n`
  } = options;
  const folderPath = `OpenProject/${projectFolder}/${folderName}`;
  const filePath = `${folderPath}/${fileName}`;
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await ensureNextcloudFolder(folderPath, user);
      await uploadNextcloudFile(filePath, content, user);
      return;
    } catch (error: unknown) {
      lastError = error;
      const message = getErrorMessage(error);
      const retryable =
        message.includes('HTTP 404') ||
        message.includes('HTTP 409') ||
        message.includes('HTTP 503') ||
        message.includes('Parent node does not exist') ||
        message.includes('LockedException');
      if (!retryable || attempt === maxAttempts) {
        break;
      }
      logWarn(
        'AMPF WebDAV seed attempt %s/%s failed (%s); retrying after OP/NC ACL settle',
        attempt,
        maxAttempts,
        message.slice(0, 180)
      );
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to seed AMPF path ${filePath}`);
}
