/**
 * Shared URL/host helpers for building regex patterns and resolving hostnames.
 */

/** Escape special regex characters in a string. */
export function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract hostname from a URL string; returns empty string if no value, or the value as-is if not a valid URL. */
export function resolveHostname(value?: string): string {
  if (!value) return '';
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

/**
 * Resolve the URL used for `page.goto` for a service: prefer full URL env, then build from
 * host env / config host using pathname + search from the locator default, else locator default.
 */
export function resolveServiceNavigationUrl(
  fullUrlEnv: string | undefined,
  hostEnv: string | undefined,
  configHost: string,
  locatorDefaultFullUrl: string,
): string {
  const full = fullUrlEnv?.trim();
  if (full) {
    try {
      const u = new URL(full);
      const loc = new URL(locatorDefaultFullUrl);
      if ((u.pathname === '/' || u.pathname === '') && loc.pathname && loc.pathname !== '/') {
        return `${u.origin}${loc.pathname}${loc.search}`;
      }
      return full;
    } catch {
      return full;
    }
  }

  const hostLike = (hostEnv || configHost || '').trim();
  if (!hostLike) return locatorDefaultFullUrl;

  let origin: string;
  try {
    const withProto = hostLike.includes('://') ? hostLike : `https://${hostLike}`;
    const u = new URL(withProto);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    return locatorDefaultFullUrl;
  }

  try {
    const loc = new URL(locatorDefaultFullUrl);
    return `${origin}${loc.pathname}${loc.search}`;
  } catch {
    return `${origin}/`;
  }
}

/** Site origin for building path-based URLs (e.g. OpenProject base without `/login`). */
export function resolveServiceOrigin(
  fullUrlEnv: string | undefined,
  hostEnv: string | undefined,
  configHost: string,
  locatorDefaultFullUrl: string,
): string {
  const nav = resolveServiceNavigationUrl(fullUrlEnv, hostEnv, configHost, locatorDefaultFullUrl);
  try {
    return new URL(nav).origin;
  } catch {
    return nav;
  }
}
