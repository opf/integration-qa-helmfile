import { Agent } from 'undici';
import { ADMIN_USER, OP_ADMIN_USER } from './test-users';
import { getErrorMessage } from './error-utils';
import { resolveEnvName, resolveHosts } from './env-hosts';
import { logInfo, logWarn } from './logger';

interface NextcloudCapabilitiesResponse {
  ocs?: {
    data?: {
      version?: { string?: string };
      capabilities?: {
        integration_openproject?: {
          app_version?: string;
          groupfolder_version?: string;
        };
        app_api?: { version?: string };
      };
    };
  };
}

interface NextcloudStatusResponse {
  versionstring?: string;
}

interface OpenProjectRootResponse {
  coreVersion?: string;
}

interface KeycloakTokenResponse {
  access_token?: string;
}

interface KeycloakServerInfoResponse {
  systemInfo?: { version?: string };
}

export interface DetectedVersions {
  nextcloud: string;
  nextcloudApiVersion: string;
  integrationApp: string;
  teamFolders: string;
  openproject: string;
  keycloak: string;
}

/**
 * Returns an undici Agent that skips TLS verification for local/dev environments.
 * Mirrors the TLS logic used in openproject-api.ts.
 */
function getDispatcher(): Agent | undefined {
  const envName = resolveEnvName();
  const allowInsecureTls = envName === 'local' || process.env.ALLOW_INSECURE_TLS === '1';
  return allowInsecureTls
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
}

/**
 * Detect Nextcloud versions via the capabilities API.
 * Falls back to status.php for the base version if capabilities fails.
 * 
 * Returns descriptive states for missing/disabled components:
 * - 'not-reachable': Service is completely unavailable
 * - 'not-installed': Nextcloud app (integration_openproject, groupfolders) is not installed
 */
async function detectNextcloudVersions(host: string): Promise<{
  version: string;
  apiVersion: string;
  integrationAppVersion: string;
  teamFoldersVersion: string;
}> {
  const dispatcher = getDispatcher();
  const notReachable = { 
    version: 'not-reachable', 
    apiVersion: 'not-reachable', 
    integrationAppVersion: 'not-reachable', 
    teamFoldersVersion: 'not-reachable' 
  };

  try {
    const response = await fetch(`https://${host}/ocs/v1.php/cloud/capabilities`, {
      headers: { 'OCS-APIRequest': 'true' },
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!response.ok) {
      logWarn(`⚠️  Nextcloud capabilities API returned HTTP ${response.status} (${host})`);
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as NextcloudCapabilitiesResponse;
    const ocs = data.ocs?.data;

    // Check if Nextcloud itself is reachable
    if (!ocs?.version?.string) {
      logWarn(`⚠️  Nextcloud API response missing version data (${host})`);
      return notReachable;
    }

    // Nextcloud is available, check individual apps
    const hasIntegrationApp = ocs?.capabilities?.integration_openproject?.app_version;
    const hasGroupFolders = ocs?.capabilities?.integration_openproject?.groupfolder_version;

    return {
      version: ocs.version.string,
      apiVersion: ocs?.capabilities?.app_api?.version || 'not-installed',
      integrationAppVersion: hasIntegrationApp || 'not-installed',
      teamFoldersVersion: hasGroupFolders || 'not-installed',
    };
  } catch (error: unknown) {
    logWarn(
      `⚠️  Nextcloud capabilities API failed (${host}):`,
      getErrorMessage(error),
    );
  }

  // Fallback: try status.php for the base version
  try {
    const statusResponse = await fetch(`https://${host}/status.php`, {
      method: 'GET',
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (statusResponse.ok) {
      const statusData = (await statusResponse.json()) as NextcloudStatusResponse;
      if (statusData.versionstring) {
        // Nextcloud is running but capabilities failed - apps are unknown
        return {
          version: statusData.versionstring,
          apiVersion: 'not-installed',
          integrationAppVersion: 'not-installed',
          teamFoldersVersion: 'not-installed',
        };
      }
    }
  } catch (error: unknown) {
    logWarn(
      `⚠️  Nextcloud status.php fallback also failed (${host}):`,
      getErrorMessage(error),
    );
  }

  return notReachable;
}

/**
 * Detect OpenProject version via the /api/v3 root endpoint (basic auth).
 * Returns 'not-reachable' if the service is unavailable.
 */
async function detectOpenProjectVersion(
  host: string,
  credentials: { username: string; password: string },
): Promise<string> {
  const dispatcher = getDispatcher();
  const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

  try {
    const response = await fetch(`https://${host}/api/v3`, {
      headers: {
        authorization: `Basic ${encoded}`,
        accept: 'application/hal+json',
      },
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!response.ok) {
      logWarn(`⚠️  OpenProject API returned HTTP ${response.status} (${host})`);
      return 'not-reachable';
    }
    const data = (await response.json()) as OpenProjectRootResponse;
    return data.coreVersion || 'not-reachable';
  } catch (error: unknown) {
    logWarn(
      `⚠️  OpenProject API detection failed (${host}):`,
      getErrorMessage(error),
    );
    return 'not-reachable';
  }
}

/**
 * Detect Keycloak version by obtaining an admin bearer token and querying /admin/serverinfo.
 * Returns 'not-reachable' if the service is unavailable or authentication fails.
 */
async function detectKeycloakVersion(
  host: string,
  credentials: { username: string; password: string },
): Promise<string> {
  const dispatcher = getDispatcher();

  try {
    // Step 1: obtain bearer token
    const tokenResponse = await fetch(
      `https://${host}/realms/master/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: credentials.username,
          password: credentials.password,
        }).toString(),
        ...(dispatcher ? { dispatcher } : {}),
      },
    );
    if (!tokenResponse.ok) {
      logWarn(`⚠️  Keycloak token request failed: HTTP ${tokenResponse.status} (${host})`);
      return 'not-reachable';
    }
    const tokenData = (await tokenResponse.json()) as KeycloakTokenResponse;
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      logWarn(`⚠️  Keycloak token response missing access_token (${host})`);
      return 'not-reachable';
    }

    // Step 2: query server info
    const infoResponse = await fetch(`https://${host}/admin/serverinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!infoResponse.ok) {
      logWarn(`⚠️  Keycloak serverinfo request failed: HTTP ${infoResponse.status} (${host})`);
      return 'not-reachable';
    }
    const infoData = (await infoResponse.json()) as KeycloakServerInfoResponse;
    return infoData.systemInfo?.version || 'not-reachable';
  } catch (error: unknown) {
    logWarn(
      `⚠️  Keycloak version detection failed (${host}):`,
      getErrorMessage(error),
    );
    return 'not-reachable';
  }
}

/**
 * Detect all service versions in parallel via their respective APIs.
 *
 * Hosts are resolved from the same environment variables and defaults
 * used by config.ts, so the detection targets match the test configuration.
 */
export async function detectAllVersions(): Promise<DetectedVersions> {
  const envName = resolveEnvName();
  const hosts = resolveHosts(envName);

  const opHost = hosts.openproject;
  const ncHost = hosts.nextcloud;
  const kcHost = hosts.keycloak;

  logInfo('\n🔍 Detecting service versions via API...');

  const [ncVersions, opVersion, kcVersion] = await Promise.all([
    detectNextcloudVersions(ncHost),
    detectOpenProjectVersion(opHost, {
      username: OP_ADMIN_USER.username,
      password: OP_ADMIN_USER.password,
    }),
    detectKeycloakVersion(kcHost, {
      username: ADMIN_USER.username,
      password: ADMIN_USER.password,
    }),
  ]);

  const detected: DetectedVersions = {
    nextcloud: ncVersions.version,
    nextcloudApiVersion: ncVersions.apiVersion,
    integrationApp: ncVersions.integrationAppVersion,
    teamFolders: ncVersions.teamFoldersVersion,
    openproject: opVersion,
    keycloak: kcVersion,
  };

  // Log detected versions in a formatted table
  logInfo('\n' + '─'.repeat(50));
  logInfo('🔍 API-Detected Versions');
  logInfo('─'.repeat(50));
  logInfo(`  OpenProject:      ${detected.openproject}`);
  logInfo(`  Nextcloud:        ${detected.nextcloud}`);
  logInfo(`  NC API Version:   ${detected.nextcloudApiVersion}`);
  logInfo(`  Integration App:  ${detected.integrationApp}`);
  logInfo(`  Team Folders:     ${detected.teamFolders}`);
  logInfo(`  Keycloak:         ${detected.keycloak}`);
  logInfo('─'.repeat(50) + '\n');

  return detected;
}
