import { defineConfig, devices } from '@playwright/test';
import { loadConfig } from './utils/config';

// Load setupMethod from config.yaml (with env var override for CI/CD)
const config = loadConfig();
const setupMethod = process.env.SETUP_METHOD || config.setupMethod;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  globalSetup: require.resolve('./global-setup'),
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: process.env.OPENPROJECT_URL || 'https://openproject.test',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true, // For self-signed certificates
    viewport: { width: 1280, height: 800 },
    // Enable headed mode for debugging (can be overridden with --headed flag)
    headless: process.env.HEADED === 'true' ? false : true,
    // Slower execution for debugging
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  // Filter tests by setupMethod from config.yaml
  // This filters tests to only run those in the matching directory
  // Environment variable SETUP_METHOD can override config.yaml value
  testMatch: setupMethod 
    ? `**/${setupMethod}/**/*.spec.ts`
    : '**/*.spec.ts',
});

