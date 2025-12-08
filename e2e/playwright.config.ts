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

// Load setupMethod from config.yaml (with env var override for CI/CD)
const config = loadConfig();
const setupMethod = process.env.SETUP_METHOD || config.setupMethod;

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
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
    baseURL: process.env.OPENPROJECT_URL || 'https://openproject.test',
    
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
      fullyParallel: true,
      workers: process.env.CI ? 2 : undefined,
      // Filter to only Keycloak test files
      testMatch: setupMethod 
        ? `**/${setupMethod}/**/kc-integration.spec.ts`
        : '**/kc-integration.spec.ts',
    },
    // Nextcloud-focused integration tests
    {
      name: 'nextcloud-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      testMatch: setupMethod
        ? `**/${setupMethod}/**/nc-integration.spec.ts`
        : '**/nc-integration.spec.ts',
    },
    // OpenProject integration tests - run sequentially (one at a time)
    {
      name: 'op-integration-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      // Filter to exclude Keycloak test files
      testMatch: setupMethod 
        ? `**/${setupMethod}/**/*.spec.ts`
        : '**/*.spec.ts',
      testIgnore: ['**/kc-integration.spec.ts', '**/nc-integration.spec.ts'],
    },
  ],
});

