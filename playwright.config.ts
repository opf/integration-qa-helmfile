import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './utils/config';

const projectRoot = path.resolve(__dirname, '..');
const caPathFromEnv = process.env.OPENPROJECT_CA_CERT_PATH || process.env.NODE_EXTRA_CA_CERTS;
const defaultCaPath = path.resolve(projectRoot, 'opnc-root-ca.crt');

if (!process.env.NODE_EXTRA_CA_CERTS) {
  const candidate = caPathFromEnv ?? defaultCaPath;
  if (fs.existsSync(candidate)) {
    process.env.NODE_EXTRA_CA_CERTS = candidate;
    console.log(`[Playwright Config] Using CA certificate: ${candidate}`);
  } else if (caPathFromEnv) {
    console.warn(`[Playwright Config] CA certificate not found at ${candidate}. TLS verification may fail.`);
  }
}

const config = loadConfig();
const baseURL = process.env.OPENPROJECT_URL || `https://${config.openproject.host}`;

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  // Default to serial execution; override with --workers <n> when needed
  workers: 1,
  // Do not retry tests automatically; fail fast so issues are visible
  retries: 0,
  globalSetup: require.resolve('./global-setup'),
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    headless: process.env.HEADLESS === 'true' ? true : false,
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    // Keycloak tests - run in parallel
    {
      name: 'keycloak-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      // Filter to only Keycloak test files
      testMatch: '**/kc-integration.spec.ts',
    },
    // Nextcloud-focused integration tests
    {
      name: 'nextcloud-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      testMatch: '**/nc-integration.spec.ts',
    },
    // OpenProject integration tests - run sequentially (one at a time)
    {
      name: 'op-integration-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      // Filter to exclude Keycloak test files
      testMatch: '**/*.spec.ts',
      testIgnore: ['**/kc-integration.spec.ts', '**/nc-integration.spec.ts'],
    },
  ],
});

