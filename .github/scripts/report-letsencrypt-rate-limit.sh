#!/usr/bin/env bash
# After PullPreview: scan this job's logs for Let's Encrypt rateLimited errors.
# On hit: prepend a banner to GITHUB_STEP_SUMMARY and emit ::error::.
# Soft-fails (exit 0) when the logs API is unavailable or no limit was found.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
parse_script="${script_dir}/parse-letsencrypt-rate-limit.sh"

if [[ ! -f "${parse_script}" ]]; then
  echo "::warning::parse-letsencrypt-rate-limit.sh missing; skipping LE rate-limit report"
  exit 0
fi

# gh prefers GH_TOKEN; Actions also exposes GITHUB_TOKEN by default.
if [[ -z "${GITHUB_TOKEN:-}" && -n "${GH_TOKEN:-}" ]]; then
  export GITHUB_TOKEN="${GH_TOKEN}"
fi
if [[ -z "${GITHUB_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" || -z "${GITHUB_RUN_ID:-}" ]]; then
  exit 0
fi

api() {
  local path="$1"
  if command -v gh >/dev/null 2>&1; then
    gh api "${path}"
    return
  fi
  curl -fsSL \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/${path#/}"
}

resolve_job_id() {
  local attempt="${GITHUB_RUN_ATTEMPT:-1}"
  local jobs_json=""
  jobs_json="$(
    api "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${attempt}/jobs?per_page=100" 2>/dev/null \
      || api "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs?per_page=100" 2>/dev/null \
      || true
  )"
  [[ -n "${jobs_json}" ]] || return 1

  if ! command -v jq >/dev/null 2>&1; then
    return 1
  fi

  jq -r --arg job "${GITHUB_JOB:-}" --arg runner "${RUNNER_NAME:-}" '
    [
      (.jobs | map(select(.runner_name == $runner and .status == "in_progress")) | .[0].id // empty),
      (.jobs | map(select(.name == $job and (.status == "in_progress" or .status == "completed"))) | .[0].id // empty),
      (.jobs | map(select(.status == "in_progress")) | .[0].id // empty)
    ]
    | map(select(. != null and . != ""))
    | .[0] // empty
  ' <<<"${jobs_json}"
}

job_id="$(resolve_job_id || true)"
if [[ -z "${job_id}" || "${job_id}" == "null" ]]; then
  echo "::notice::Could not resolve job id for Let's Encrypt rate-limit scan; skipping"
  exit 0
fi

tmp_logs="$(mktemp)"
trap 'rm -f "${tmp_logs}"' EXIT

if ! api "repos/${GITHUB_REPOSITORY}/actions/jobs/${job_id}/logs" >"${tmp_logs}" 2>/dev/null; then
  echo "::notice::Could not download job logs for Let's Encrypt rate-limit scan; skipping"
  exit 0
fi

message=""
if ! message="$(bash "${parse_script}" <"${tmp_logs}")"; then
  exit 0
fi

echo "::error title=LetsEncrypt rate limit::${message}"

summary_file="${GITHUB_STEP_SUMMARY:-}"
[[ -n "${summary_file}" ]] || exit 0

tmp_summary="$(mktemp)"
{
  echo "## ${message}"
  echo ""
  if [[ -f "${summary_file}" ]]; then
    cat "${summary_file}"
  fi
} >"${tmp_summary}"
cat "${tmp_summary}" >"${summary_file}"
rm -f "${tmp_summary}"
