import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { resolveEnvName, resolveHosts } from './env-hosts';
import { logDebug } from './logger';

export type SetupMethod = 'sso-external' | 'sso-nextcloud' | 'oauth2';

export interface TestConfig {
  envName: string;
  setupMethod: SetupMethod;
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

const SETUP_METHODS: readonly SetupMethod[] = ['sso-external', 'sso-nextcloud', 'oauth2'];

function isSetupMethod(value: string | undefined): value is SetupMethod {
  return value !== undefined && (SETUP_METHODS as readonly string[]).includes(value);
}

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

/** Local helm override — mirrors cluster setupMethod when SETUP_METHOD is unset. */
function readSetupMethodFromOverrideYaml(): SetupMethod | undefined {
  const overridePath = path.resolve(__dirname, '../../environments/override.yaml');
  if (!fs.existsSync(overridePath)) {
    return undefined;
  }
  try {
    const text = fs.readFileSync(overridePath, 'utf8');
    const match = text.match(/^\s*setupMethod:\s*['"]?(oauth2|sso-external|sso-nextcloud)['"]?/m);
    if (match && isSetupMethod(match[1])) {
      logDebug(`[config] setupMethod from environments/override.yaml: ${match[1]}`);
      return match[1];
    }
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * Resolve auth setup method for gating @oauth2 / @sso-external tests.
 * Priority: SETUP_METHOD env → --setupMethod → e2e-env.json → environments/override.yaml → sso-external.
 */
export function resolveSetupMethod(fromE2eEnv?: string): SetupMethod {
  for (const candidate of [
    process.env.SETUP_METHOD,
    getArgValue('--setupMethod'),
    fromE2eEnv,
    readSetupMethodFromOverrideYaml(),
  ]) {
    if (isSetupMethod(candidate)) {
      return candidate;
    }
  }
  return 'sso-external';
}

const E2E_ENV_FILE = path.resolve(path.dirname(__dirname), 'test-results', 'e2e-env.json');

export function loadConfig(): TestConfig {
  loadDotEnvLocal();

  let e2eEnvSetupMethod: string | undefined;
  if (fs.existsSync(E2E_ENV_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(E2E_ENV_FILE, 'utf8')) as Record<string, string>;
      for (const [k, v] of Object.entries(data)) {
        if (v == null) continue;
        // Do not let a stale SETUP_METHOD in e2e-env clobber shell / override resolution order.
        if (k === 'SETUP_METHOD') {
          e2eEnvSetupMethod = v;
          continue;
        }
        process.env[k] = v;
      }
    } catch {
      // use env defaults
    }
  }

  const envName = resolveEnvName();
  const setupMethod = resolveSetupMethod(e2eEnvSetupMethod);
  process.env.SETUP_METHOD = setupMethod;

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
