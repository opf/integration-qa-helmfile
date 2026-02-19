import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './utils/config';
import { logInfo, logWarn } from './utils/logger';

const projectRoot = path.resolve(__dirname, '..');
const caPathFromEnv = process.env.OPENPROJECT_CA_CERT_PATH || process.env.NODE_EXTRA_CA_CERTS;
const defaultCaPath = path.resolve(projectRoot, 'opnc-root-ca.crt');

if (!process.env.NODE_EXTRA_CA_CERTS) {
  const candidate = caPathFromEnv ?? defaultCaPath;
  if (fs.existsSync(candidate)) {
    process.env.NODE_EXTRA_CA_CERTS = candidate;
    logInfo('[Playwright Config] Using CA certificate:', candidate);
  } else if (caPathFromEnv) {
    logWarn('[Playwright Config] CA certificate not found at', candidate, '- TLS verification may fail.');
  }
}

const config = loadConfig();
const baseURL = process.env.OPENPROJECT_URL || `https://${config.openproject.host}`;

const workersFromEnv = process.env.E2E_WORKERS
  ? parseInt(process.env.E2E_WORKERS, 10)
  : 1;

function runTimestamp(): string {
  const d = new Date();
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D}_${h}-${m}-${s}`;
}

// Report and run artifacts in timestamped folder outside test-results (Playwright disallows HTML report inside test-results)
const runDir = `playwright-report/run-${runTimestamp()}`;

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  workers: Number.isNaN(workersFromEnv) ? 1 : workersFromEnv,
  retries: 0,
  globalSetup: require.resolve('./global-setup'),
  reporter: [
    ['list'],
    ['html', { outputFolder: `${runDir}/report`, open: 'never' }],
    ['json', { outputFile: `${runDir}/results.json` }],
    ['junit', { outputFile: `${runDir}/junit.xml` }],
  ],
  use: {
    baseURL: baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    headless: true,
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'keycloak-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      testMatch: '**/kc-integration.spec.ts',
    },
    {
      name: 'nextcloud-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      testMatch: '**/nc-integration.spec.ts',
    },
    {
      name: 'op-integration-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      testMatch: '**/*.spec.ts',
      testIgnore: ['**/kc-integration.spec.ts', '**/nc-integration.spec.ts'],
    },
  ],
});

