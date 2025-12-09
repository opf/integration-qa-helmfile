#!/usr/bin/env node

/**
 * Standalone script to wait for setup-job to complete
 * Usage: npx ts-node e2e/scripts/wait-for-setup.ts
 * Or: npm run wait-for-setup
 */

import { waitForSetupJobComplete, setupJobExists, isSetupJobComplete } from '../utils/pod-waiter';

const namespace = process.env.KUBERNETES_NAMESPACE || 'opnc-integration';

async function main() {
  console.log(`Checking setup-job in namespace '${namespace}'...\n`);

  // Check if setup-job exists
  const exists = await setupJobExists(namespace);
  if (!exists) {
    console.error(`❌ Setup-job not found in namespace '${namespace}'`);
    console.error('   Make sure the integration is deployed: make deploy');
    process.exit(1);
  }

  // Check if already complete
  const isComplete = await isSetupJobComplete(namespace);
  if (isComplete) {
    console.log('✓ Setup-job is already completed');
    process.exit(0);
  }

  // Wait for completion
  try {
    await waitForSetupJobComplete(namespace);
    console.log('\n✓ Setup-job completed successfully. Ready to run tests!');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Error waiting for setup-job:', error.message);
    process.exit(1);
  }
}

main();

