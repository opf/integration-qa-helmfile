import { FullConfig } from '@playwright/test';
import { waitForSetupJobComplete, setupJobExists, isSetupJobComplete } from './utils/pod-waiter';
import { detectAllVersions } from './utils/version-detect';
import { getErrorMessage } from './utils/error-utils';
import { logInfo, logError, logWarn } from './utils/logger';

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
      logWarn(`⚠️  Setup-job not found in namespace '${namespace}'. Skipping check.`);
      logInfo('   If you are running tests against a pre-deployed environment,');
      logInfo('   set SKIP_SETUP_JOB_CHECK=true to skip this check.');
    } else {
      // Check if already complete
      const isComplete = await isSetupJobComplete(namespace);
      if (isComplete) {
        logInfo('✓ Setup-job is already completed');
      } else {
        // Wait for setup-job to complete
        try {
          await waitForSetupJobComplete(namespace);
        } catch (error: unknown) {
          logError('❌ Setup-job check failed:', getErrorMessage(error));
          logError('\nTo skip this check, set SKIP_SETUP_JOB_CHECK=true');
          throw error;
        }
      }
    }
  } else {
    logInfo('⏭️  Skipping setup-job check (enable with SETUP_JOB_CHECK=true)');
  }

  // ── Step 2: Detect service versions via API ─────────────────────
  try {
    const detected = await detectAllVersions();

    // Store detected versions as env vars.
    // Existing env vars take precedence (act as manual overrides).
    // States like 'not-reachable' and 'not-installed' are preserved
    // so tests can see which services/apps are unavailable.
    const envMap: Record<string, string> = {
      OPENPROJECT_VERSION: detected.openproject,
      NEXTCLOUD_VERSION: detected.nextcloud,
      NEXTCLOUD_API_VERSION: detected.nextcloudApiVersion,
      INTEGRATION_APP_VERSION: detected.integrationApp,
      NEXTCLOUD_TEAM_FOLDERS_VERSION: detected.teamFolders,
      KEYCLOAK_VERSION: detected.keycloak,
    };

    for (const [key, value] of Object.entries(envMap)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error: unknown) {
    logWarn('⚠️  Version detection failed:', getErrorMessage(error));
    logWarn('   Tests will use "not-detected" as fallback.');
  }
}

export default globalSetup;

