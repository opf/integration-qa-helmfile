import { FullConfig } from '@playwright/test';
import { waitForSetupJobComplete, setupJobExists, isSetupJobComplete } from './utils/pod-waiter';

/**
 * Global setup that runs before all tests
 * Waits for setup-job to complete if SKIP_SETUP_JOB_CHECK is not set
 */
async function globalSetup(config: FullConfig) {
  // Skip if explicitly disabled
  if (process.env.SKIP_SETUP_JOB_CHECK === 'true') {
    console.log('⏭️  Skipping setup-job check (SKIP_SETUP_JOB_CHECK=true)');
    return;
  }

  const namespace = process.env.KUBERNETES_NAMESPACE || 'opnc-integration';
  
  // Check if setup-job exists
  const exists = await setupJobExists(namespace);
  if (!exists) {
    console.log(`⚠️  Setup-job not found in namespace '${namespace}'. Skipping check.`);
    console.log('   If you are running tests against a pre-deployed environment,');
    console.log('   set SKIP_SETUP_JOB_CHECK=true to skip this check.');
    return;
  }

  // Check if already complete
  const isComplete = await isSetupJobComplete(namespace);
  if (isComplete) {
    console.log('✓ Setup-job is already completed');
    return;
  }

  // Wait for setup-job to complete
  try {
    await waitForSetupJobComplete(namespace);
  } catch (error: any) {
    console.error('❌ Setup-job check failed:', error.message);
    console.error('\nTo skip this check, set SKIP_SETUP_JOB_CHECK=true');
    throw error;
  }
}

export default globalSetup;

