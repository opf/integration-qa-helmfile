import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { resolveEnvName, resolveHosts } from './env-hosts';
import { logInfo, logDebug } from './logger';

export interface TestConfig {
  envName: string;
  setupMethod: 'sso-external';
  openproject: {
    version: string;
    host: string;
  };
  nextcloud: {
    version: string;
    apiVersion: string;
    host: string;
    integrationAppVersion: string;
    teamFoldersVersion: string;
  };
  keycloak: {
    version: string;
    host: string;
  };
}

type SetupMethod = TestConfig['setupMethod'];

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
    logDebug(`[config] Loaded .env.local from ${envPath}`);
  }
}

const E2E_ENV_FILE = path.resolve(path.dirname(__dirname), 'test-results', 'e2e-env.json');

export function loadConfig(): TestConfig {
  loadDotEnvLocal();

  if (fs.existsSync(E2E_ENV_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(E2E_ENV_FILE, 'utf8')) as Record<string, string>;
      for (const [k, v] of Object.entries(data)) if (v != null) process.env[k] = v;
    } catch {
      // use env defaults
    }
  }

  const envName = resolveEnvName();

  const setupMethod = (
    process.env.SETUP_METHOD ||
    getArgValue('--setupMethod') ||
    'sso-external'
  ) as SetupMethod;

  const hosts = resolveHosts(envName);
  const openprojectHost = hosts.openproject;
  const nextcloudHost = hosts.nextcloud;
  const keycloakHost = hosts.keycloak;

  const openprojectVersion = process.env.OPENPROJECT_VERSION || 'not-detected';
  const nextcloudVersion = process.env.NEXTCLOUD_VERSION || 'not-detected';
  const nextcloudApiVersion = process.env.NEXTCLOUD_API_VERSION || 'not-detected';
  const integrationAppVersion = process.env.INTEGRATION_APP_VERSION || 'not-detected';
  const teamFoldersVersion = process.env.NEXTCLOUD_TEAM_FOLDERS_VERSION || 'not-detected';
  const keycloakVersion = process.env.KEYCLOAK_VERSION || 'not-detected';

  return {
    envName,
    setupMethod,
    openproject: {
      version: openprojectVersion,
      host: openprojectHost,
    },
    nextcloud: {
      version: nextcloudVersion,
      apiVersion: nextcloudApiVersion,
      host: nextcloudHost,
      integrationAppVersion,
      teamFoldersVersion,
    },
    keycloak: {
      version: keycloakVersion,
      host: keycloakHost,
    },
  };
}

export const testConfig = loadConfig();
