import { exec } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage } from './error-utils';
import { logInfo, logWarn } from './logger';

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
  } catch {
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
  
  logInfo(`Waiting for setup-job to complete in namespace '${namespace}'...`);
  
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
          } catch (logError: unknown) {
            throw new Error(`Setup job failed: ${getErrorMessage(logError)}`);
          }
        }
        
        logInfo('Setup job completed successfully');
        return;
      }
      
      // Show progress
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const currentStatus = status.trim() || 'Pending';
      if (currentStatus !== lastStatus) {
        logInfo(`  Status: ${currentStatus} (${elapsed}s elapsed)`);
        lastStatus = currentStatus;
      }
      
    } catch (error: unknown) {
      // Job might not exist yet or kubectl error
      const message = getErrorMessage(error);
      if (!message.includes('not found') && !message.includes('No resources found')) {
        logWarn(`  Warning checking setup-job: ${message}`);
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
  } catch (error: unknown) {
    throw new Error(
      `Setup job did not complete within ${maxWaitTime / 1000}s timeout.\n` +
      `Error: ${getErrorMessage(error)}`
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

