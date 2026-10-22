#!/usr/bin/env bash
# Parse Caddy/ACME log text on stdin for Let's Encrypt rateLimited errors.
# Prints one line on success: "LetsEncrypt limit hit, reset DD.MM.YY at HH:MM:SS TZ"
# Exit 0 if a rate limit was found, 1 otherwise.
set -euo pipefail

latest=""
while IFS= read -r line || [[ -n "${line}" ]]; do
  [[ "${line}" == *urn:ietf:params:acme:error:rateLimited* ]] || continue
  rest="${line}"
  while [[ "${rest}" =~ retry\ after\ ([0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2})\ UTC ]]; do
    ts="${BASH_REMATCH[1]}"
    if [[ -z "${latest}" || "${ts}" > "${latest}" ]]; then
      latest="${ts}"
    fi
    rest="${rest#*"${BASH_REMATCH[0]}"}"
  done
done

[[ -n "${latest}" ]] || exit 1

format_reset() {
  local utc_ts="$1"
  if date -d "1970-01-01 00:00:00 UTC" '+%s' >/dev/null 2>&1; then
    TZ=Europe/Berlin date -d "${utc_ts} UTC" '+%d.%m.%y at %H:%M:%S %Z'
    return
  fi
  # BSD date (macOS)
  local epoch
  epoch="$(date -j -u -f '%Y-%m-%d %H:%M:%S' "${utc_ts}" '+%s')"
  TZ=Europe/Berlin date -j -f '%s' "${epoch}" '+%d.%m.%y at %H:%M:%S %Z'
}

formatted="$(format_reset "${latest}")"
echo "LetsEncrypt limit hit, reset ${formatted}"
