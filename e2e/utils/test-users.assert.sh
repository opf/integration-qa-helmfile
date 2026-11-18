#!/usr/bin/env bash
# Assert test-users.ts refuses only passwords on PullPreview (usernames keep defaults).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
E2E="${ROOT}/e2e"

fail() { echo "[FAIL] $*" >&2; exit 1; }
pass() { echo "[OK] $*"; }

# Import the module under a clean credential env. Unset username/email overrides.
run_import() {
  (
    cd "${E2E}"
    unset E2E_KC_ADMIN_USER E2E_OP_ADMIN_USER E2E_NC_ADMIN_USER
    unset E2E_ALICE_USER E2E_BRIAN_USER E2E_OLIVER_USER E2E_BOB_USER E2E_FILES_AUTH_USER
    unset E2E_OLIVER_EMAIL E2E_BOB_EMAIL E2E_FILES_AUTH_EMAIL
    unset E2E_KC_ADMIN_PASS E2E_OP_ADMIN_PASS E2E_NC_ADMIN_PASS
    unset E2E_ALICE_PASS E2E_BRIAN_PASS E2E_OLIVER_PASS E2E_BOB_PASS E2E_FILES_AUTH_PASS
    unset E2E_ADMIN_PASS E2E_USER_PASS
    export "$@"
    node --experimental-strip-types -e "import('./utils/test-users.ts').then(() => console.log('imported'))"
  )
}

# Passwords via role envs only; usernames unset → must succeed on PullPreview.
if ! run_import \
  E2E_ENV=pullpreview \
  E2E_ADMIN_PASS=PullPreviewAdminPass01 \
  E2E_USER_PASS=PullPreviewUserPass01 \
  >/dev/null; then
  fail "PullPreview with passwords only should import"
fi
pass "PullPreview passwords-only import succeeds"

# Password missing → must fail.
if run_import E2E_ENV=pullpreview >/dev/null 2>&1; then
  fail "PullPreview without passwords should throw"
fi
pass "PullPreview without passwords throws"

# Local still accepts defaults with no env.
if ! run_import E2E_ENV=local >/dev/null; then
  fail "local defaults should import"
fi
pass "local defaults import succeeds"

echo "[PASS] test-users PullPreview credential contract"
