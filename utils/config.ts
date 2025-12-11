import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export interface TestConfig {
  envName: string;
  setupMethod: 'sso-external';
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

type SetupMethod = TestConfig['setupMethod'];

const DEFAULTS = {
  edge: {
    openprojectHost: 'openproject.edge',
    nextcloudHost: 'nextcloud.edge',
    keycloakHost: 'keycloak.edge',
  },
  stage: {
    openprojectHost: 'openproject.stage',
    nextcloudHost: 'nextcloud.stage',
    keycloakHost: 'keycloak.stage',
  },
  local: {
    openprojectHost: 'openproject.test',
    nextcloudHost: 'nextcloud.test',
    keycloakHost: 'keycloak.test',
  },
};

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && index < process.argv.length - 1) {
    return process.argv[index + 1];
  }
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) {
    return inline.split('=')[1];
  }
  return undefined;
}

function loadDotEnvLocal(): void {
  const projectRoot = path.resolve(__dirname, '..');
  const envPath = path.resolve(projectRoot, '.env.local');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`[config] Loaded .env.local from ${envPath}`);
  }
}

export function loadConfig(): TestConfig {
  loadDotEnvLocal();

  const envName = (
    process.env.E2E_ENV ||
    process.env.ENV ||
    getArgValue('--env') ||
    'local'
  ).toLowerCase();

  const setupMethod = (
    process.env.SETUP_METHOD ||
    getArgValue('--setupMethod') ||
    'sso-external'
  ) as SetupMethod;

  const defaults = DEFAULTS[envName as keyof typeof DEFAULTS] || DEFAULTS.local;

  const openprojectHost =
    process.env.OPENPROJECT_HOST ||
    process.env.OPENPROJECT_URL || // backwards compatibility
    defaults.openprojectHost;
  const nextcloudHost =
    process.env.NEXTCLOUD_HOST ||
    process.env.NEXTCLOUD_URL ||
    defaults.nextcloudHost;
  const keycloakHost =
    process.env.KEYCLOAK_HOST ||
    process.env.KEYCLOAK_URL ||
    defaults.keycloakHost;

  const openprojectVersion = process.env.OPENPROJECT_VERSION || '16';
  const nextcloudVersion = process.env.NEXTCLOUD_VERSION || '32';
  const integrationAppVersion = process.env.INTEGRATION_APP_VERSION || '';
  const keycloakVersion = process.env.KEYCLOAK_VERSION || '26.2.5';

  console.log('\n' + '='.repeat(60));
  console.log('📋 Test Configuration Detected');
  console.log('='.repeat(60));
  console.log(`🔧 Env:              ${envName}`);
  console.log(`🔧 Setup Method:     ${setupMethod}${process.env.SETUP_METHOD ? ' (from env)' : getArgValue('--setupMethod') ? ' (from flag)' : ' (default)'}`);
  console.log(`📦 OpenProject:      v${openprojectVersion}`);
  console.log(`🌐 OpenProject Host: ${openprojectHost}`);
  console.log(`📦 Nextcloud:        v${nextcloudVersion}`);
  console.log(`🌐 Nextcloud Host:   ${nextcloudHost}`);
  console.log(`🔌 Integration App:  ${integrationAppVersion || '(not specified)'}`);
  console.log(`🔐 Keycloak:         v${keycloakVersion}`);
  console.log(`🌐 Keycloak Host:    ${keycloakHost}`);
  console.log('='.repeat(60) + '\n');

  return {
    envName,
    setupMethod,
    openproject: {
      version: openprojectVersion,
      host: openprojectHost,
    },
    nextcloud: {
      version: nextcloudVersion,
      host: nextcloudHost,
      integrationAppVersion,
    },
    keycloak: {
      version: keycloakVersion,
      host: keycloakHost,
    },
  };
}

export const testConfig = loadConfig();
