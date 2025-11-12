import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Check if setup-job is completed
 * @param namespace Kubernetes namespace (default: opnc-integration)
 * @returns true if setup-job is completed successfully, false otherwise
 */
export async function isSetupJobComplete(namespace: string = 'opnc-integration'): Promise<boolean> {
  try {
    // Check if job exists and is complete
    const { stdout } = await execAsync(
      `kubectl get job setup-job -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo ""`
    );
    
    return stdout.trim() === 'True';
  } catch (error) {
    return false;
  }
}

/**
 * Wait for setup-job to complete
 * @param namespace Kubernetes namespace (default: opnc-integration)
 * @param maxWaitTime Maximum wait time in milliseconds (default: 15 minutes)
 * @param checkInterval Interval between checks in milliseconds (default: 5 seconds)
 */
export async function waitForSetupJobComplete(
  namespace: string = 'opnc-integration',
  maxWaitTime: number = 900000, // 15 minutes
  checkInterval: number = 5000 // 5 seconds
): Promise<void> {
  const startTime = Date.now();
  let lastStatus = '';
  
  console.log(`Waiting for setup-job to complete in namespace '${namespace}'...`);
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      // Check job status
      const { stdout: status } = await execAsync(
        `kubectl get job setup-job -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}' 2>/dev/null || echo ""`
      );
      
      if (status.trim() === 'True') {
        // Verify it completed successfully (not failed)
        const { stdout: failed } = await execAsync(
          `kubectl get job setup-job -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}' 2>/dev/null || echo ""`
        );
        
        if (failed.trim() === 'True') {
          // Get job logs for debugging
          try {
            const { stdout: logs } = await execAsync(
              `kubectl logs -n ${namespace} -l job-name=setup-job --tail=50 2>/dev/null || echo "Could not retrieve logs"`
            );
            throw new Error(`Setup job failed. Last logs:\n${logs}`);
          } catch (logError: any) {
            throw new Error(`Setup job failed: ${logError.message}`);
          }
        }
        
        console.log('✓ Setup job completed successfully');
        return;
      }
      
      // Show progress
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const currentStatus = status.trim() || 'Pending';
      if (currentStatus !== lastStatus) {
        console.log(`  Status: ${currentStatus} (${elapsed}s elapsed)`);
        lastStatus = currentStatus;
      }
      
    } catch (error: any) {
      // Job might not exist yet or kubectl error
      if (!error.message.includes('not found') && !error.message.includes('No resources found')) {
        console.warn(`  Warning checking setup-job: ${error.message}`);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }
  
  // Get final status for error message
  try {
    const { stdout: finalStatus } = await execAsync(
      `kubectl get job setup-job -n ${namespace} -o jsonpath='{.status}' 2>/dev/null || echo "{}"`
    );
    throw new Error(
      `Setup job did not complete within ${maxWaitTime / 1000}s timeout.\n` +
      `Final status: ${finalStatus}`
    );
  } catch (error: any) {
    throw new Error(
      `Setup job did not complete within ${maxWaitTime / 1000}s timeout.\n` +
      `Error: ${error.message}`
    );
  }
}

/**
 * Check if setup-job pod exists
 * @param namespace Kubernetes namespace (default: opnc-integration)
 * @returns true if setup-job pod exists, false otherwise
 */
export async function setupJobExists(namespace: string = 'opnc-integration'): Promise<boolean> {
  try {
    await execAsync(`kubectl get job setup-job -n ${namespace} >/dev/null 2>&1`);
    return true;
  } catch {
    return false;
  }
}

