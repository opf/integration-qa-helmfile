import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

export interface TestConfig {
  setupMethod: 'oauth2' | 'sso-nextcloud' | 'sso-external';
  openproject: {
    version: string;
    host: string;
  };
  nextcloud: {
    version: string;
    host: string;
    integrationAppVersion: string;
  };
  keycloak: {
    version: string;
    host: string;
  };
}

/**
 * Reads and parses the config.yaml file
 * Supports environment variable overrides for CI/CD
 */
export function loadConfig(): TestConfig {
  // Resolve path relative to project root (one level up from e2e)
  const projectRoot = path.resolve(__dirname, '../..');
  const configPath = path.resolve(projectRoot, 'environments/default/config.yaml');
  
  // Read config file
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config = parse(configContent) as any;

  // Extract values with environment variable overrides
  const setupMethod = (process.env.SETUP_METHOD || config.integration?.setupMethod || 'oauth2') as TestConfig['setupMethod'];
  const openprojectVersion = process.env.OPENPROJECT_VERSION || config.openproject?.version || '16';
  const nextcloudVersion = process.env.NEXTCLOUD_VERSION || config.nextcloud?.version || '32';
  const integrationAppVersion = process.env.INTEGRATION_APP_VERSION || 
    config.nextcloud?.enableApps?.find((app: any) => app.name === 'integration_openproject')?.version || '';
  const keycloakVersion = process.env.KEYCLOAK_VERSION || config.keycloak?.version || '26.2.5';

  // Log configuration information
  console.log('\n' + '='.repeat(60));
  console.log('📋 Test Configuration Detected');
  console.log('='.repeat(60));
  console.log(`🔧 Setup Method:     ${setupMethod}${process.env.SETUP_METHOD ? ' (from env)' : ' (from config.yaml)'}`);
  console.log(`📦 OpenProject:      v${openprojectVersion}${process.env.OPENPROJECT_VERSION ? ' (from env)' : ''}`);
  console.log(`📦 Nextcloud:        v${nextcloudVersion}${process.env.NEXTCLOUD_VERSION ? ' (from env)' : ''}`);
  console.log(`🔌 Integration App:   ${integrationAppVersion || '(not specified)'}${process.env.INTEGRATION_APP_VERSION ? ' (from env)' : ''}`);
  console.log(`🔐 Keycloak:         v${keycloakVersion}${process.env.KEYCLOAK_VERSION ? ' (from env)' : ''}`);
  console.log('='.repeat(60) + '\n');

  return {
    setupMethod,
    openproject: {
      version: openprojectVersion,
      host: config.openproject?.host || 'openproject.test',
    },
    nextcloud: {
      version: nextcloudVersion,
      host: config.nextcloud?.host || 'nextcloud.test',
      integrationAppVersion,
    },
    keycloak: {
      version: keycloakVersion,
      host: config.keycloak?.host || 'keycloak.test',
    },
  };
}

// Export singleton instance
export const testConfig = loadConfig();

