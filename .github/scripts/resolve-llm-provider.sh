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
# LLM_MODEL:
#   empty | provider-default  → provider default model
#   meta-llama/llama-3.3-70b-instruct → Llama-3.3-70b-instruct on llm-stack;
#                                       passthrough on openrouter
#   other OpenRouter ids → openrouter only; rejected on llm-stack
#
# Default output (stdout, key=value for GITHUB_OUTPUT):
#   llm_provider, llm_api_key, llm_base_url, llm_model
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

resolve_model() {
  local req="$1"
  if [[ -z "${req}" || "${req}" == "provider-default" ]]; then
    echo "${default_model}"
    return
  fi

  if [[ "${provider}" == "llm-stack" ]]; then
    case "${req}" in
      meta-llama/llama-3.3-70b-instruct|Llama-3.3-70b-instruct)
        echo "Llama-3.3-70b-instruct"
        ;;
      *)
        echo "::error::llm-stack only supports Llama-3.3-70b-instruct (got: ${req}). Use llm_provider=openrouter for other models." >&2
        exit 1
        ;;
    esac
    return
  fi

  # openrouter: map legacy llm-stack id to OpenRouter id
  if [[ "${req}" == "Llama-3.3-70b-instruct" ]]; then
    echo "meta-llama/llama-3.3-70b-instruct"
    return
  fi
  echo "${req}"
}

model="$(resolve_model "${requested_model}")"

if [[ "${export_mode}" == "true" ]]; then
  printf 'export LLM_PROVIDER=%q\n' "${provider}"
  printf 'export LLM_API_KEY=%q\n' "${api_key}"
  printf 'export LLM_BASE_URL=%q\n' "${base_url}"
  printf 'export LLM_MODEL=%q\n' "${model}"
else
  echo "llm_provider=${provider}"
  echo "llm_api_key=${api_key}"
  echo "llm_base_url=${base_url}"
  echo "llm_model=${model}"
fi
