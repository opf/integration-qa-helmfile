#!/usr/bin/env bash
# Resolve LLM provider presets for mcp-eval (OpenAI-compatible APIs).
#
# Usage: resolve-llm-provider.sh [--export] [provider]
#   --export        print shell export lines (LLM_*) instead of key=value
#   provider        llm-stack (default) | openrouter
#
# Reads (optional overrides):
#   LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
#   LLM_STACK_API_KEY, LLM_STACK_URL          (llm-stack legacy)
#   OPENROUTER_API_KEY                       (openrouter)
#
# LLM_MODEL / LLM_JUDGE_MODEL dropdown choices are "<slug>-llmstack" or
# "<slug>-openrouter" (GitHub shows that string as the option). The suffix must
# match LLM_PROVIDER. The slug maps to the API model id below.
#   empty | provider-default  → provider default model
#   same-as-agent (judge only) → resolved agent model
# Legacy raw ids (no suffix) still resolve: OpenRouter ids pass through;
# llm-stack still accepts only its mapped ids.
#
# Default output (stdout, key=value for GITHUB_OUTPUT):
#   llm_provider, llm_api_key, llm_base_url, llm_model, llm_judge_model
set -euo pipefail

export_mode=false
if [[ "${1:-}" == "--export" ]]; then
  export_mode=true
  shift
fi

provider="${1:-${LLM_PROVIDER:-llm-stack}}"
requested_model="${LLM_MODEL:-}"

case "${provider}" in
  llm-stack)
    default_url="https://llm-stack.openproject-edge.eu/v1"
    default_model="Llama-3.3-70b-instruct"
    api_key="${LLM_API_KEY:-${LLM_STACK_API_KEY:-}}"
    ;;
  openrouter)
    default_url="https://openrouter.ai/api/v1"
    default_model="meta-llama/llama-3.3-70b-instruct"
    api_key="${LLM_API_KEY:-${OPENROUTER_API_KEY:-}}"
    ;;
  *)
    echo "::error::Unknown LLM_PROVIDER: ${provider} (expected llm-stack or openrouter)" >&2
    exit 1
    ;;
esac

base_url="${LLM_BASE_URL:-${default_url}}"

# Prefer LLM_STACK_URL only for llm-stack when LLM_BASE_URL is unset
if [[ "${provider}" == "llm-stack" && -z "${LLM_BASE_URL:-}" && -n "${LLM_STACK_URL:-}" ]]; then
  base_url="${LLM_STACK_URL}"
fi

# Dropdown suffix, or empty when the value is a raw model id.
choice_provider_of() {
  case "$1" in
    *-llmstack) echo "llm-stack" ;;
    *-openrouter) echo "openrouter" ;;
    *) echo "" ;;
  esac
}

assert_same_provider() {
  local label="$1"
  local req="$2"
  local implied
  implied="$(choice_provider_of "${req}")"
  if [[ -n "${implied}" && "${implied}" != "${provider}" ]]; then
    echo "::error::${label} '${req}' belongs to ${implied}, but llm_provider is ${provider}." >&2
    exit 1
  fi
}

resolve_model() {
  local req="$1"
  local slug="${req}"
  case "${req}" in
    *-llmstack|*-openrouter) slug="${req%-llmstack}"; slug="${slug%-openrouter}" ;;
  esac

  if [[ -z "${slug}" || "${slug}" == "provider-default" ]]; then
    echo "${default_model}"
    return
  fi

  # ponytail: llm-stack ids are the gateway's /v1/models names. The four slugs
  # are the dropdown; fix the right-hand side when the gateway catalog changes.
  case "${provider}:${slug}" in
    llm-stack:qwen-2.5-7b) echo "Qwen/Qwen2.5-7B-Instruct" ;;
    llm-stack:llama-3.1-8b) echo "Llama-3.1-8B-Instruct" ;;
    llm-stack:llama-3.3-70b|llm-stack:Llama-3.3-70b-instruct|llm-stack:meta-llama/llama-3.3-70b-instruct)
      echo "Llama-3.3-70b-instruct"
      ;;
    llm-stack:deepseek-v3) echo "deepseek-v3" ;;
    openrouter:gpt-4.1-mini|openrouter:openai/gpt-4.1-mini) echo "openai/gpt-4.1-mini" ;;
    openrouter:gemini-2.5-flash|openrouter:google/gemini-2.5-flash) echo "google/gemini-2.5-flash" ;;
    openrouter:claude-sonnet-4.5|openrouter:anthropic/claude-sonnet-4.5) echo "anthropic/claude-sonnet-4.5" ;;
    openrouter:gpt-4.1|openrouter:openai/gpt-4.1) echo "openai/gpt-4.1" ;;
    openrouter:Llama-3.3-70b-instruct|openrouter:meta-llama/llama-3.3-70b-instruct)
      echo "meta-llama/llama-3.3-70b-instruct"
      ;;
    openrouter:*)
      echo "${slug}"
      ;;
    *)
      echo "::error::Unknown llm-stack model '${req}'. Choices: qwen-2.5-7b-llmstack, llama-3.1-8b-llmstack, llama-3.3-70b-llmstack, deepseek-v3-llmstack." >&2
      exit 1
      ;;
  esac
}

assert_same_provider "llm_model" "${requested_model}"
assert_same_provider "llm_judge_model" "${LLM_JUDGE_MODEL:-}"

model="$(resolve_model "${requested_model}")"

requested_judge="${LLM_JUDGE_MODEL:-}"
if [[ -z "${requested_judge}" || "${requested_judge}" == "same-as-agent" ]]; then
  judge_model="${model}"
else
  judge_model="$(resolve_model "${requested_judge}")"
fi

if [[ "${export_mode}" == "true" ]]; then
  printf 'export LLM_PROVIDER=%q\n' "${provider}"
  printf 'export LLM_API_KEY=%q\n' "${api_key}"
  printf 'export LLM_BASE_URL=%q\n' "${base_url}"
  printf 'export LLM_MODEL=%q\n' "${model}"
  printf 'export LLM_JUDGE_MODEL=%q\n' "${judge_model}"
else
  echo "llm_provider=${provider}"
  echo "llm_api_key=${api_key}"
  echo "llm_base_url=${base_url}"
  echo "llm_model=${model}"
  echo "llm_judge_model=${judge_model}"
fi
