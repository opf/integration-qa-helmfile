import { defineConfig, devices } from '@playwright/test';
import { loadConfig } from './utils/config';

// Load setupMethod from config.yaml (with env var override for CI/CD)
const config = loadConfig();
const setupMethod = process.env.SETUP_METHOD || config.setupMethod;

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
    // Other tests - run sequentially (one at a time)
    {
      name: 'other-tests',
      use: { ...devices['Desktop Chrome'] },
      fullyParallel: false,
      workers: 1,
      // Filter to exclude Keycloak test files
      testMatch: setupMethod 
        ? `**/${setupMethod}/**/*.spec.ts`
        : '**/*.spec.ts',
      testIgnore: ['**/kc-integration.spec.ts'],
    },
  ],
});

