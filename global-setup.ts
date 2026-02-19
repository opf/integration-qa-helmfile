import * as fs from 'fs';
import * as path from 'path';
import { FullConfig } from '@playwright/test';
import { waitForSetupJobComplete, setupJobExists, isSetupJobComplete } from './utils/pod-waiter';
import { detectAllVersions } from './utils/version-detect';
import { ensureKeycloakDirectAccessForNextcloud } from './utils/nextcloud-api';
import { getErrorMessage } from './utils/error-utils';
import { logInfo, logError, logWarn } from './utils/logger';
import { resolveEnvName, resolveHosts } from './utils/env-hosts';

/**
 * Global setup that runs before all tests.
 *
 * 1. Waits for the setup-job to complete (if SETUP_JOB_CHECK=true).
 * 2. Detects service versions via API and stores them as environment
 *    variables so that config.ts and tests can read them.
 *    Existing env vars are treated as overrides and are never replaced.
 */
async function globalSetup(config: FullConfig) {
  // ── Step 1: Setup-job check (optional) ──────────────────────────
  if (process.env.SETUP_JOB_CHECK === 'true') {
    const namespace = process.env.KUBERNETES_NAMESPACE || 'opnc-integration';

    // Check if setup-job exists
    const exists = await setupJobExists(namespace);
    if (!exists) {
      logWarn(`Setup-job not found in namespace '${namespace}'. Skipping check.`);
      logInfo('   If you are running tests against a pre-deployed environment,');
      logInfo('   set SKIP_SETUP_JOB_CHECK=true to skip this check.');
    } else {
      // Check if already complete
      const isComplete = await isSetupJobComplete(namespace);
      if (isComplete) {
        logInfo('Setup-job is already completed');
      } else {
        // Wait for setup-job to complete
        try {
          await waitForSetupJobComplete(namespace);
        } catch (error: unknown) {
          logError('Setup-job check failed:', getErrorMessage(error));
          logError('\nTo skip this check, set SKIP_SETUP_JOB_CHECK=true');
          throw error;
        }
      }
    }
  } else {
    logInfo('Skipping setup-job check (enable with SETUP_JOB_CHECK=true)');
  }

  // Step 2: Detect service versions via API and persist for workers
  const envName = resolveEnvName();
  const hosts = resolveHosts(envName);
  const setupMethod = process.env.SETUP_METHOD || 'sso-external';
  let detectedVersions: Record<string, string> = {
    OPENPROJECT_VERSION: 'not-detected',
    NEXTCLOUD_VERSION: 'not-detected',
    NEXTCLOUD_API_VERSION: 'not-detected',
    INTEGRATION_APP_VERSION: 'not-detected',
    NEXTCLOUD_TEAM_FOLDERS_VERSION: 'not-detected',
    KEYCLOAK_VERSION: 'not-detected',
  };

  try {
    const detected = await detectAllVersions();
    const envMap: Record<string, string> = {
      OPENPROJECT_VERSION: detected.openproject,
      NEXTCLOUD_VERSION: detected.nextcloud,
      NEXTCLOUD_API_VERSION: detected.nextcloudApiVersion,
      INTEGRATION_APP_VERSION: detected.integrationApp,
      NEXTCLOUD_TEAM_FOLDERS_VERSION: detected.teamFolders,
      KEYCLOAK_VERSION: detected.keycloak,
    };
    for (const [key, value] of Object.entries(envMap)) {
      if (!process.env[key]) process.env[key] = value;
      detectedVersions[key] = process.env[key]!;
    }
  } catch (error: unknown) {
    logWarn('Version detection failed:', getErrorMessage(error));
  }

  const outDir = path.join(process.cwd(), 'test-results');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'e2e-env.json'),
    JSON.stringify(detectedVersions, null, 0),
  );

  logInfo('\n' + '='.repeat(60));
  logInfo('Test Configuration');
  logInfo('='.repeat(60));
  logInfo(`Env:              ${envName}`);
  logInfo(`Setup Method:     ${setupMethod}`);
  logInfo(`OpenProject:      ${detectedVersions.OPENPROJECT_VERSION}  (${hosts.openproject})`);
  logInfo(`Nextcloud:        ${detectedVersions.NEXTCLOUD_VERSION}  (${hosts.nextcloud})`);
  logInfo(`NC API Version:   ${detectedVersions.NEXTCLOUD_API_VERSION}`);
  logInfo(`Integration App:  ${detectedVersions.INTEGRATION_APP_VERSION}`);
  logInfo(`Team Folders:     ${detectedVersions.NEXTCLOUD_TEAM_FOLDERS_VERSION}`);
  logInfo(`Keycloak:         ${detectedVersions.KEYCLOAK_VERSION}  (${hosts.keycloak})`);
  logInfo('='.repeat(60) + '\n');

  // ── Step 3: Enable direct access grants for Nextcloud WebDAV ────────
  try {
    await ensureKeycloakDirectAccessForNextcloud();
    logInfo('Keycloak direct access grants enabled for Nextcloud WebDAV');
  } catch (error: unknown) {
    logWarn('Failed to enable Keycloak direct access grants:', getErrorMessage(error));
    logWarn('   Nextcloud WebDAV operations may fail.');
  }
}

export default globalSetup;

