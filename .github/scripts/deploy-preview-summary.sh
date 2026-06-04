#!/usr/bin/env bash
# Append deploy status and expected preview URLs to GITHUB_STEP_SUMMARY (runs on failure too).
set -euo pipefail

preview_name="${PREVIEW_NAME:-}"
pullpreview_outcome="${PULLPREVIEW_OUTCOME:-}"
pullpreview_live="${PULLPREVIEW_LIVE:-}"
preview_url="${PREVIEW_URL:-}"
in_skip_tests="${IN_SKIP_TESTS:-false}"

summary_file="${GITHUB_STEP_SUMMARY:-}"
[[ -n "${summary_file}" ]] || exit 0

{
  echo ""
  echo "### Deploy status"
  echo ""
  echo "- Preview label: \`${preview_name:-unknown}\`"
  echo "- PullPreview step: \`${pullpreview_outcome:-skipped}\` | live=\`${pullpreview_live:-}\`"
  if [[ "${in_skip_tests}" == "true" ]]; then
    echo "- Mode: setup-only (skip_tests)"
  fi
  echo ""
  echo "### Expected endpoints"
  echo ""
} >> "${summary_file}"

if [[ -n "${preview_url}" ]]; then
  preview_host="${preview_url#https://}"
  preview_host="${preview_host#http://}"
  preview_host="${preview_host%%/*}"
  preview_host="${preview_host%%:*}"
  {
    echo "- OpenProject: ${preview_url}"
    echo "- Nextcloud: https://nextcloud.${preview_host}"
    echo "- Keycloak: https://keycloak.${preview_host}/realms/opnc"
    echo "- XWiki: https://xwiki.${preview_host}"
  } >> "${summary_file}"
else
  echo "_Preview URL not available (deploy did not become live). Check **PullPreview up** logs for diagnostics and SSH heartbeats._" >> "${summary_file}"
  if [[ -n "${preview_name}" ]]; then
    echo "" >> "${summary_file}"
    echo "Cleanup label for **PullPreview Cleanup**: \`${preview_name}\`" >> "${summary_file}"
  fi
fi

echo "" >> "${summary_file}"

if [[ "${pullpreview_live}" != "true" ]]; then
  echo "::notice::Deploy did not become live. See **Deploy status** in the job summary and PullPreview up logs."
fi
