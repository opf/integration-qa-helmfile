#!/usr/bin/env bash
# Assert check-llm-credentials.sh empty-key and HTTP status handling.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${ROOT}/.github/scripts/check-llm-credentials.sh"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

if env -i PATH="${PATH}" "${SCRIPT}" llm-stack >/dev/null 2>&1; then
  fail "empty key should fail"
fi
pass "empty LLM_STACK_API_KEY fails"

# Local OpenAI-compatible stub: GET /models with Bearer auth.
stub_dir="$(mktemp -d)"
trap 'kill "${stub_pid:-}" 2>/dev/null || true; rm -rf "${stub_dir}"' EXIT
cat >"${stub_dir}/server.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
import os

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        auth = self.headers.get("Authorization", "")
        if self.path != "/v1/models":
            self.send_response(404)
            self.end_headers()
            return
        if auth != "Bearer good-key":
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error":"unauthorized"}')
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"data":[{"id":"m"}]}')

    def log_message(self, *_args):
        pass

HTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
PY

PORT=18765
PORT="${PORT}" python3 "${stub_dir}/server.py" &
stub_pid=$!
sleep 0.3

if env -i PATH="${PATH}" \
  LLM_API_KEY=bad-key \
  LLM_BASE_URL="http://127.0.0.1:${PORT}/v1" \
  "${SCRIPT}" openrouter >/dev/null 2>&1; then
  fail "401 should fail"
fi
pass "HTTP 401 fails"

if ! env -i PATH="${PATH}" \
  LLM_API_KEY=good-key \
  LLM_BASE_URL="http://127.0.0.1:${PORT}/v1" \
  LLM_MODEL=provider-default \
  "${SCRIPT}" openrouter >/dev/null; then
  fail "200 should pass"
fi
pass "HTTP 200 passes"

if env -i PATH="${PATH}" \
  LLM_API_KEY=good-key \
  LLM_BASE_URL="http://127.0.0.1:1/v1" \
  "${SCRIPT}" openrouter >/dev/null 2>&1; then
  fail "unreachable should fail"
fi
pass "unreachable host fails"

echo "[PASS] check-llm-credentials"
