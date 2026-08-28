#!/usr/bin/env bash
# Assert record-run-metadata.py writes metadata and enriches results.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="${ROOT}/e2e/mcp-eval/scripts/record-run-metadata.py"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

mkdir -p "${TMP}/reports"
cat >"${TMP}/reports/results.json" <<'EOF'
{"tasks":[{"name":"[TS-01] a","status":"passed"},{"name":"[TS-02] b","status":"failed"}]}
EOF

export REPORTS_DIR="${TMP}/reports"
export LLM_PROVIDER=openrouter
export LLM_MODEL=openai/gpt-4o-mini
export LLM_BASE_URL=https://openrouter.ai/api/v1
export OPENPROJECT_URL=https://preview.example
export GITHUB_OUTPUT="${TMP}/github_output"
export GITHUB_STEP_SUMMARY="${TMP}/summary.md"
: >"${GITHUB_OUTPUT}"
: >"${GITHUB_STEP_SUMMARY}"

python3 "${SCRIPT}"

meta="${TMP}/reports/run-metadata.json"
[[ -f "${meta}" ]] || fail "missing run-metadata.json"
grep -q '"llm_model": "openai/gpt-4o-mini"' "${meta}" || fail "model missing in metadata"
grep -q '"llm_provider": "openrouter"' "${meta}" || fail "provider missing in metadata"

python3 - <<PY
import json
from pathlib import Path
data = json.loads(Path("${TMP}/reports/results.json").read_text())
assert data["run"]["llm_model"] == "openai/gpt-4o-mini", data
assert data["run"]["llm_provider"] == "openrouter", data
assert len(data["tasks"]) == 2
PY
pass "enriched results.json"

grep -qxF "artifact_slug=openrouter-openai-gpt-4o-mini" "${GITHUB_OUTPUT}" || fail "bad artifact_slug ($(cat "${GITHUB_OUTPUT}"))"
grep -qxF "passed=1" "${GITHUB_OUTPUT}" || fail "passed count missing"
grep -qxF "failed=1" "${GITHUB_OUTPUT}" || fail "failed count missing"
pass "GITHUB_OUTPUT"

grep -q 'Model: `openai/gpt-4o-mini`' "${GITHUB_STEP_SUMMARY}" || fail "summary missing model"
grep -q 'Passed: 1, Failed: 1' "${GITHUB_STEP_SUMMARY}" || fail "summary missing counts"
pass "GITHUB_STEP_SUMMARY"

echo "[PASS] record-run-metadata"
