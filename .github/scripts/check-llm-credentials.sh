#!/usr/bin/env bash
# Resolve the selected LLM provider and probe the OpenAI-compatible /models
# endpoint so mcp-eval fails before PullPreview when the key is missing,
# expired, or the server is unreachable.
#
# Env:
#   LLM_PROVIDER (or argv[1])   llm-stack | openrouter
#   LLM_MODEL, LLM_API_KEY, LLM_BASE_URL, LLM_STACK_*, OPENROUTER_API_KEY
#     (same as resolve-llm-provider.sh)
#
# Exit 0 on HTTP 2xx from GET ${base_url}/models with Bearer auth.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RESOLVE="${ROOT}/.github/scripts/resolve-llm-provider.sh"
provider="${1:-${LLM_PROVIDER:-llm-stack}}"

resolved="$("${RESOLVE}" "${provider}")"
llm_api_key="$(printf '%s\n' "${resolved}" | sed -n 's/^llm_api_key=//p')"
llm_base_url="$(printf '%s\n' "${resolved}" | sed -n 's/^llm_base_url=//p')"
llm_model="$(printf '%s\n' "${resolved}" | sed -n 's/^llm_model=//p')"
llm_provider="$(printf '%s\n' "${resolved}" | sed -n 's/^llm_provider=//p')"

if [[ -z "${llm_api_key}" ]]; then
  if [[ "${llm_provider}" == "openrouter" ]]; then
    echo "::error::Secret OPENROUTER_API_KEY (or LLM_API_KEY) is not set or empty."
  else
    echo "::error::Secret LLM_STACK_API_KEY (or LLM_API_KEY) is not set or empty."
  fi
  exit 1
fi

models_url="${llm_base_url%/}/models"
echo "Probing ${llm_provider} at ${models_url} (model=${llm_model})"

tmp_body="$(mktemp)"
trap 'rm -f "${tmp_body}"' EXIT

set +e
http_code="$(
  curl -sS -o "${tmp_body}" -w '%{http_code}' \
    --connect-timeout 10 \
    --max-time 30 \
    -H "Authorization: Bearer ${llm_api_key}" \
    -H "Accept: application/json" \
    "${models_url}"
)"
curl_exit=$?
set -e

if [[ "${curl_exit}" -ne 0 ]]; then
  echo "::error::LLM provider ${llm_provider} unreachable at ${models_url} (curl exit ${curl_exit})."
  exit 1
fi

case "${http_code}" in
  2??)
    echo "LLM credentials OK (${llm_provider}, HTTP ${http_code})."
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
      {
        echo "### LLM credentials"
        echo ""
        echo "- Provider: \`${llm_provider}\`"
        echo "- Base URL: \`${llm_base_url}\`"
        echo "- Model: \`${llm_model}\`"
        echo "- Probe: \`GET /models\` → HTTP ${http_code}"
        echo ""
      } >> "${GITHUB_STEP_SUMMARY}"
    fi
    exit 0
    ;;
  401|403)
    echo "::error::LLM provider ${llm_provider} rejected the API key (HTTP ${http_code}). Key may be missing, expired, or unauthorized."
    exit 1
    ;;
  *)
    echo "::error::LLM provider ${llm_provider} probe failed (HTTP ${http_code}) at ${models_url}."
    head -c 500 "${tmp_body}" >&2 || true
    echo >&2
    exit 1
    ;;
esac
