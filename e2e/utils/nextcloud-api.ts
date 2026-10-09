import { exec } from 'child_process';
import { promisify } from 'util';
import { ADMIN_USER, NC_ADMIN_USER } from './test-users';
import { getErrorMessage } from './error-utils';
import { resolveEnvName, resolveHosts } from './env-hosts';
import { tlsFetch } from './tls-dispatcher';
import { logInfo, logWarn } from './logger';
import { testConfig } from './config';
import type { TestUser } from './test-users';

const execAsync = promisify(exec);
const OPENPROJECT_NC_GROUP = 'OpenProject';
const DEFAULT_AMPF_FOLDER_ID = '1';
const DEFAULT_AMPF_PROJECT_FOLDER = 'Demo project (1)';

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
  authorization: string,
  fallbackUsername: string
): Promise<string> {
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await tlsFetch(
      `https://${ncHost}/ocs/v1.php/cloud/user?format=json`,
      {
        headers: {
          authorization,
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
): Promise<{ ncHost: string; userId: string; authorization: string }> {
  const hosts = resolveHosts(resolveEnvName());
  // oauth2 local users authenticate with Nextcloud basic auth; SSO uses Keycloak ROPC.
  const authorization =
    testConfig.setupMethod === 'oauth2'
      ? `Basic ${buildNextcloudBasicAuth(user)}`
      : `Bearer ${await getKeycloakTokenForUser(hosts.keycloak, user)}`;
  const userId = await resolveNextcloudUserId(hosts.nextcloud, authorization, user.username);
  return { ncHost: hosts.nextcloud, userId, authorization };
}

async function fileExists(
  ncHost: string,
  userId: string,
  filePath: string,
  authorization: string
): Promise<boolean> {
  const response = await tlsFetch(buildWebDavUrl(ncHost, userId, filePath), {
    method: 'HEAD',
    headers: { authorization }
  });
  return response.ok;
}

async function deleteFile(
  ncHost: string,
  userId: string,
  filePath: string,
  authorization: string
): Promise<void> {
  const response = await tlsFetch(buildWebDavUrl(ncHost, userId, filePath), {
    method: 'DELETE',
    headers: { authorization }
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
  authorization: string
): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await tlsFetch(buildWebDavUrl(ncHost, userId, folderPath), {
      method: 'MKCOL',
      headers: { authorization }
    });
    // 201 created; 405 already exists (WebDAV)
    if (response.status === 201 || response.status === 405 || response.status === 301) {
      return;
    }
    if (response.status === 409 && (await fileExists(ncHost, userId, folderPath, authorization))) {
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
  authorization: string
): Promise<void> {
  const body =
    typeof content === 'string' ? content : new Uint8Array(content);
  const response = await tlsFetch(buildWebDavUrl(ncHost, userId, filePath), {
    method: 'PUT',
    headers: {
      authorization,
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

function buildNextcloudBasicAuth(user: TestUser): string {
  return Buffer.from(`${user.username}:${user.password}`).toString('base64');
}

interface NextcloudOcsMeta {
  status?: string;
  statuscode?: number;
  message?: string;
}

/**
 * Idempotently create a local Nextcloud user via OCS users API (admin basic auth).
 * Returns true when a new user was created; false when the user already existed.
 */
export async function ensureNextcloudLocalUser(
  user: TestUser,
  admin: TestUser = NC_ADMIN_USER
): Promise<{ created: boolean }> {
  const hosts = resolveHosts(resolveEnvName());
  const ncHost = hosts.nextcloud;
  const auth = buildNextcloudBasicAuth(admin);
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
  const email = user.email ?? `${user.username}@example.com`;

  const getResponse = await tlsFetch(
    `https://${ncHost}/ocs/v1.php/cloud/users/${encodeURIComponent(user.username)}?format=json`,
    {
      headers: {
        authorization: `Basic ${auth}`,
        'OCS-APIRequest': 'true',
        accept: 'application/json',
      },
    }
  );

  if (getResponse.ok) {
    const existing = (await getResponse.json()) as { ocs?: { meta?: NextcloudOcsMeta } };
    if (existing.ocs?.meta?.statuscode === 100) {
      logInfo('Nextcloud user already exists: %s', user.username);
      return { created: false };
    }
  }

  const body = new URLSearchParams({
    userid: user.username,
    password: user.password,
    displayName,
    email,
  });

  const createResponse = await tlsFetch(
    `https://${ncHost}/ocs/v1.php/cloud/users?format=json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'OCS-APIRequest': 'true',
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    }
  );

  const createText = await createResponse.text();
  let statusCode: number | undefined;
  try {
    const data = JSON.parse(createText) as { ocs?: { meta?: NextcloudOcsMeta } };
    statusCode = data.ocs?.meta?.statuscode;
  } catch (error: unknown) {
    logWarn('Nextcloud create-user response was not JSON: %s', getErrorMessage(error));
  }

  // 100 = success; 102 = user already exists
  if (statusCode === 100) {
    logInfo('Created Nextcloud user: %s', user.username);
    return { created: true };
  }
  if (statusCode === 102) {
    logInfo('Nextcloud user already exists: %s', user.username);
    return { created: false };
  }

  throw new Error(
    `Nextcloud OCS create user failed for '${user.username}': HTTP ${createResponse.status} statuscode=${statusCode} - ${createText}`
  );
}

/**
 * Idempotently add a Nextcloud user to a group (admin OCS).
 * Used so oauth2 local users can see the OpenProject Team Folder mount.
 */
export async function ensureNextcloudUserInGroup(
  username: string,
  groupId: string,
  admin: TestUser = NC_ADMIN_USER,
): Promise<void> {
  const hosts = resolveHosts(resolveEnvName());
  const auth = buildNextcloudBasicAuth(admin);
  const body = new URLSearchParams({ groupid: groupId });
  const response = await tlsFetch(
    `https://${hosts.nextcloud}/ocs/v1.php/cloud/users/${encodeURIComponent(username)}/groups?format=json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'OCS-APIRequest': 'true',
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  );
  const text = await response.text();
  let statusCode: number | undefined;
  try {
    const data = JSON.parse(text) as { ocs?: { meta?: NextcloudOcsMeta } };
    statusCode = data.ocs?.meta?.statuscode;
  } catch (error: unknown) {
    logWarn('Nextcloud add-to-group response was not JSON: %s', getErrorMessage(error));
  }
  // 100 success; 102 already in group
  if (statusCode === 100 || statusCode === 102) {
    logInfo('Nextcloud user %s is in group %s', username, groupId);
    return;
  }
  throw new Error(
    `Nextcloud OCS add user to group failed for '${username}' → '${groupId}': HTTP ${response.status} statuscode=${statusCode} - ${text}`,
  );
}

async function setGroupfoldersUserPermissions(
  folderId: string,
  path: string,
  username: string,
  permissions: string[],
): Promise<void> {
  const namespace = process.env.KUBERNETES_NAMESPACE || 'opnc-integration';
  const permArgs = permissions.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(' ');
  const pathArg = path.replace(/'/g, `'\\''`);
  const cmd =
    `kubectl exec -n ${namespace} deploy/nextcloud -- su -s /bin/sh www-data -c ` +
    `"php occ groupfolders:permissions ${folderId} '${pathArg}' -u ${username} ${permArgs} --"`;
  try {
    await execAsync(cmd, { timeout: 60_000 });
  } catch (error: unknown) {
    throw new Error(
      `Failed to set groupfolders permissions for ${username} on '${path}': ${getErrorMessage(error)}`,
    );
  }
}

/**
 * oauth2-only: give a local NC user Team Folder mount + write access to the AMPF project folder.
 * SSO users get this via the integration app; local Oliver does not until these grants exist.
 */
export async function ensureOauth2AmpfWebDavAccess(
  user: TestUser,
  options: { folderId?: string; projectFolder?: string } = {},
): Promise<void> {
  if (testConfig.setupMethod !== 'oauth2') {
    return;
  }
  const folderId = options.folderId ?? DEFAULT_AMPF_FOLDER_ID;
  const projectFolder = options.projectFolder ?? DEFAULT_AMPF_PROJECT_FOLDER;

  await ensureNextcloudUserInGroup(user.username, OPENPROJECT_NC_GROUP);
  await setGroupfoldersUserPermissions(folderId, '/', user.username, ['+read']);
  await setGroupfoldersUserPermissions(folderId, projectFolder, user.username, [
    '+read',
    '+write',
    '+create',
    '+delete',
  ]);
  logInfo(
    'Granted oauth2 AMPF WebDAV access for %s on %s/%s',
    user.username,
    OPENPROJECT_NC_GROUP,
    projectFolder,
  );
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
  const { ncHost, userId, authorization } = await withWebDavAuth(user);

  // Check if file exists before attempting deletion (idempotency check)
  const exists = await fileExists(ncHost, userId, filePath, authorization);
  if (!exists) {
    logInfo('File not found (already deleted or never existed): %s', filePath);
    return;
  }

  await deleteFile(ncHost, userId, filePath, authorization);
}

/**
 * Ensure a WebDAV folder exists (idempotent MKCOL).
 * Path is relative to the user's files root, e.g. `OpenProject/Demo project (1)/R&D`.
 */
export async function ensureNextcloudFolder(
  folderPath: string,
  user: TestUser
): Promise<void> {
  const { ncHost, userId, authorization } = await withWebDavAuth(user);
  if (await fileExists(ncHost, userId, folderPath, authorization)) {
    logInfo('Nextcloud folder already exists: %s', folderPath);
    return;
  }
  await createFolder(ncHost, userId, folderPath, authorization);
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
  const { ncHost, userId, authorization } = await withWebDavAuth(user);
  await putFile(ncHost, userId, filePath, content, authorization);
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
