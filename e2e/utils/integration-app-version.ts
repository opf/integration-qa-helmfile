import { tlsFetch } from './tls-dispatcher';
import { getErrorMessage } from './error-utils';
import { logDebug, logWarn } from './logger';

const GITHUB_LATEST_RELEASE =
  'https://api.github.com/repos/nextcloud/integration_openproject/releases/latest';

/**
 * Strip pre-release / metadata and return [major, minor, patch], or null if unparseable.
 */
export function parseVersionCore(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative if a < b, 0 if equal, positive if a > b. Null if either is unparseable. */
export function compareVersionCores(a: string, b: string): number | null {
  const pa = parseVersionCore(a);
  const pb = parseVersionCore(b);
  if (!pa || !pb) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}

/**
 * Nightly / git / dated / pre-release builds are not App Store releases.
 * Replacing them with marketplace install would downgrade (e.g. 3.3.0-nightly → 3.2.0).
 */
export function isUnstableIntegrationAppVersion(version: string): boolean {
  if (!version || version === 'not-detected' || version === 'not-installed' || version === 'not-reachable') {
    return false;
  }
  return /nightly|dev|alpha|beta|rc|\d{8}|git/i.test(version);
}

interface GithubReleaseResponse {
  tag_name?: string;
}

export async function fetchLatestMarketplaceIntegrationAppVersion(): Promise<string | null> {
  try {
    const response = await tlsFetch(GITHUB_LATEST_RELEASE, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) {
      logWarn(
        '[integration-app-version] GitHub latest release HTTP',
        String(response.status),
      );
      return null;
    }
    const data = (await response.json()) as GithubReleaseResponse;
    const tag = data.tag_name?.replace(/^v/, '') ?? null;
    logDebug('[integration-app-version] Marketplace latest release:', tag ?? 'unknown');
    return tag;
  } catch (error: unknown) {
    logWarn(
      '[integration-app-version] Failed to fetch marketplace latest release:',
      getErrorMessage(error),
    );
    return null;
  }
}

export interface MarketplaceInstallSkipDecision {
  skip: boolean;
  reason: string;
}

/**
 * Skip marketplace install when the deployed app would be downgraded by the App Store.
 */
export async function shouldSkipMarketplaceInstall(
  deployedVersion: string,
): Promise<MarketplaceInstallSkipDecision> {
  if (
    !deployedVersion ||
    deployedVersion === 'not-detected' ||
    deployedVersion === 'not-installed' ||
    deployedVersion === 'not-reachable'
  ) {
    return { skip: false, reason: '' };
  }

  if (isUnstableIntegrationAppVersion(deployedVersion)) {
    return {
      skip: true,
      reason: `Deployed integration app ${deployedVersion} is a pre-release/nightly/git build; marketplace install would downgrade`,
    };
  }

  const marketplaceVersion = await fetchLatestMarketplaceIntegrationAppVersion();
  if (!marketplaceVersion) {
    return { skip: false, reason: '' };
  }

  const cmp = compareVersionCores(deployedVersion, marketplaceVersion);
  if (cmp !== null && cmp > 0) {
    return {
      skip: true,
      reason: `Deployed integration app ${deployedVersion} is newer than marketplace ${marketplaceVersion}; skipping to avoid downgrade`,
    };
  }

  return { skip: false, reason: '' };
}

