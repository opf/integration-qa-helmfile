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
