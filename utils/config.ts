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

export function loadConfig(): TestConfig {
  loadDotEnvLocal();

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

  logInfo('\n' + '='.repeat(60));
  logInfo('📋 Test Configuration');
  logInfo('='.repeat(60));
  logInfo(`🔧 Env:              ${envName}`);
  logInfo(`🔧 Setup Method:     ${setupMethod}${process.env.SETUP_METHOD ? ' (from env)' : getArgValue('--setupMethod') ? ' (from flag)' : ' (default)'}`);
  logInfo(`📦 OpenProject:      ${openprojectVersion}`);
  logInfo(`🌐 OpenProject Host: ${openprojectHost}`);
  logInfo(`📦 Nextcloud:        ${nextcloudVersion}`);
  logInfo(`📦 NC API Version:   ${nextcloudApiVersion}`);
  logInfo(`🌐 Nextcloud Host:   ${nextcloudHost}`);
  logInfo(`🔌 Integration App:  ${integrationAppVersion}`);
  logInfo(`📁 Team Folders:     ${teamFoldersVersion}`);
  logInfo(`🔐 Keycloak:         ${keycloakVersion}`);
  logInfo(`🌐 Keycloak Host:    ${keycloakHost}`);
  logInfo('='.repeat(60) + '\n');

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
