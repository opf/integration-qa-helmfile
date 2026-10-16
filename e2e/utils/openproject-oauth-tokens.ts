import { execFile } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage } from './error-utils';
import { logInfo, logWarn } from './logger';

const execFileAsync = promisify(execFile);

const DEFAULT_NAMESPACE = process.env.KUBERNETES_NAMESPACE || 'opnc-integration';

async function railsRunner(
  ruby: string,
  options: { namespace?: string } = {},
): Promise<string> {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  const { stdout, stderr } = await execFileAsync(
    'kubectl',
    [
      '-n',
      namespace,
      'exec',
      'deploy/openproject-web',
      '-c',
      'openproject',
      '--',
      'bundle',
      'exec',
      'rails',
      'runner',
      ruby,
    ],
    { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  );
  if (stderr?.trim()) {
    logWarn('rails runner stderr: %s', stderr.trim().slice(0, 400));
  }
  return stdout;
}

/**
 * Expire OpenProject→Nextcloud storage access tokens for a user while keeping refresh_token.
 * Uses kubectl + rails runner (requires cluster access; not available inside Docker E2E).
 *
 * Silent refresh relies on expires_in + created_at: access is treated expired when
 * created_at + expires_in is in the past.
 */
export async function expireOpenProjectStorageAccessTokens(
  userLogin: string,
  options: { namespace?: string } = {},
): Promise<number> {
  const login = userLogin.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const ruby = [
    `u = User.find_by(login: '${login}') || User.find_by(mail: '${login}')`,
    `raise "OpenProject user '${login}' not found" unless u`,
    `scope = OAuthClientToken.where(user_id: u.id)`,
    `n = scope.count`,
    `raise "No OAuthClientToken rows for user '${login}'" if n.zero?`,
    `scope.find_each { |t| t.update_columns(created_at: 2.hours.ago, expires_in: 1, updated_at: Time.current) }`,
    `puts n`,
  ].join('; ');

  try {
    const stdout = await railsRunner(ruby, options);
    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const count = Number(lines[lines.length - 1]);
    if (!Number.isFinite(count) || count < 1) {
      throw new Error(`Unexpected rails runner output: ${stdout.slice(0, 300)}`);
    }
    logInfo('Expired %s OAuthClientToken access token(s) for %s', count, userLogin);
    return count;
  } catch (error: unknown) {
    throw new Error(
      `Failed to expire OAuthClientToken for '${userLogin}': ${getErrorMessage(error)}`,
    );
  }
}

export interface StorageOauthClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Read Nextcloud OAuth client credentials stored on the OP storage (oauth_clients table).
 * Used to re-enter the same values in Admin → File storages (non-destructive).
 */
/**
 * Delete all OAuthClientToken rows for a user (refresh + access). Prefer UI revoke when
 * visible; this is the reliable fallback matching Squash "delete token record".
 */
export async function deleteOpenProjectStorageOAuthTokens(
  userLogin: string,
  options: { namespace?: string } = {},
): Promise<number> {
  const login = userLogin.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const ruby = [
    `u = User.find_by(login: '${login}') || User.find_by(mail: '${login}')`,
    `raise "OpenProject user '${login}' not found" unless u`,
    `n = OAuthClientToken.where(user_id: u.id).delete_all`,
    `puts n`,
  ].join('; ');

  try {
    const stdout = await railsRunner(ruby, options);
    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const count = Number(lines[lines.length - 1]);
    if (!Number.isFinite(count)) {
      throw new Error(`Unexpected rails runner output: ${stdout.slice(0, 300)}`);
    }
    logInfo('Deleted %s OAuthClientToken row(s) for %s', count, userLogin);
    return count;
  } catch (error: unknown) {
    throw new Error(
      `Failed to delete OAuthClientToken for '${userLogin}': ${getErrorMessage(error)}`,
    );
  }
}

/** Run AMPF managed-folder sync to completion for the first/named storage. */
export async function runAutomaticallyManagedStorageSync(
  options: { namespace?: string; storageName?: string } = {},
): Promise<void> {
  const name = (options.storageName ?? 'nextcloud').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const ruby = [
    `s = Storages::Storage.find_by(name: '${name}') || Storages::Storage.first`,
    `raise 'No file storage found' unless s`,
    `Storages::AutomaticallyManagedStorageSyncJob.perform_now(s)`,
    `puts 'ok'`,
  ].join('; ');

  try {
    const stdout = await railsRunner(ruby, options);
    if (!stdout.includes('ok')) {
      throw new Error(`Sync job finished without ok marker: ${stdout.slice(0, 300)}`);
    }
    logInfo('AutomaticallyManagedStorageSyncJob completed for storage');
  } catch (error: unknown) {
    throw new Error(
      `Failed to run AutomaticallyManagedStorageSyncJob: ${getErrorMessage(error)}`,
    );
  }
}

const E2E_NO_FILES_ROLE = 'E2E No Files';

/**
 * Keep OP project membership (WP access) but strip file-storage permissions so AMPF
 * sync sets Nextcloud ACL to 0. Raw NC ACL strips are undone by the next sync when the
 * user still has read_files/write_files on a Member role.
 */
export async function revokeAmpfAccessByStrippingFilePermissions(
  userLogin: string,
  projectIdentifier: string,
  options: { namespace?: string; storageName?: string } = {},
): Promise<void> {
  const login = userLogin.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const project = projectIdentifier.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const roleName = E2E_NO_FILES_ROLE.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const storageName = (options.storageName ?? 'nextcloud')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

  const ruby = [
    `role = ProjectRole.find_or_initialize_by(name: '${roleName}')`,
    `role.permissions = %i[view_project view_work_packages view_file_links]`,
    `role.save!`,
    `u = User.find_by(login: '${login}') || User.find_by(mail: '${login}')`,
    `raise "OpenProject user '${login}' not found" unless u`,
    `p = Project.find_by(identifier: '${project}') || Project.find_by(name: '${project}')`,
    `raise "OpenProject project '${project}' not found" unless p`,
    `m = Member.find_by(user_id: u.id, project_id: p.id)`,
    `raise "No membership for '${login}' on '${project}'" unless m`,
    `m.role_ids = [role.id]`,
    `m.save!`,
    `s = Storages::Storage.find_by(name: '${storageName}') || Storages::Storage.first`,
    `raise 'No file storage found' unless s`,
    `Storages::AutomaticallyManagedStorageSyncJob.perform_now(s)`,
    `puts 'ok'`,
  ].join('; ');

  try {
    const stdout = await railsRunner(ruby, options);
    if (!stdout.includes('ok')) {
      throw new Error(`Role strip + sync finished without ok: ${stdout.slice(0, 300)}`);
    }
    logInfo(
      'Stripped file permissions for %s on %s (role %s) and ran AMPF sync',
      userLogin,
      projectIdentifier,
      E2E_NO_FILES_ROLE,
    );
  } catch (error: unknown) {
    throw new Error(
      `Failed to revoke AMPF access for '${userLogin}' on '${projectIdentifier}': ${getErrorMessage(error)}`,
    );
  }
}

export async function getNextcloudStorageOauthClientCredentials(
  options: { namespace?: string; storageName?: string } = {},
): Promise<StorageOauthClientCredentials> {
  const name = (options.storageName ?? 'nextcloud').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const ruby = [
    `s = Storages::Storage.find_by(name: '${name}') || Storages::Storage.first`,
    `raise 'No file storage found' unless s`,
    `c = OAuthClient.find_by(integration: s)`,
    `raise "No OAuthClient for storage #{s.name}" unless c`,
    `puts({ clientId: c.client_id, clientSecret: c.client_secret }.to_json)`,
  ].join('; ');

  try {
    const stdout = await railsRunner(ruby, options);
    const line = stdout
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{'))
      .pop();
    if (!line) {
      throw new Error(`No JSON credentials in rails output: ${stdout.slice(0, 300)}`);
    }
    const parsed = JSON.parse(line) as StorageOauthClientCredentials;
    if (!parsed.clientId || !parsed.clientSecret) {
      throw new Error(`Incomplete OAuth credentials: ${line}`);
    }
    logInfo('Loaded Nextcloud storage OAuth client id for re-enter (%s…)', parsed.clientId.slice(0, 8));
    return parsed;
  } catch (error: unknown) {
    throw new Error(
      `Failed to load storage OAuth credentials: ${getErrorMessage(error)}`,
    );
  }
}
