# E2E Integration Tests

Playwright E2E tests for OpenProject, Nextcloud, and Keycloak integration.

## Requirements

- Docker (for Docker-based runs), or Node.js (see `.node-version`) and npm for native runs
- Integration stack from this repository (see root `README.md`)

## Quick Start

**Docker (no local Node.js required):**
```bash
./run-tests.sh
```

**Native:**
```bash
npm install
npm run playwright:install
E2E_ENV=local npx playwright test
```

## Docs

**E2E conventions and runs:** `.agents/shared/openproject-e2e.md` (thin adapters: Cursor/Codex `.agents/skills/tests/SKILL.md`, Cursor `.cursor/rules/openproject-e2e.mdc`, Claude `.claude/skills/tests/SKILL.md`).

**`playwright-cli`** (interactive only; not `npx playwright test`): `.agents/shared/playwright-cli/SKILL.md` via thin adapters in `.agents/skills/playwright-cli/SKILL.md` and `.claude/skills/playwright-cli/SKILL.md`; references live under `.agents/shared/playwright-cli/references/`.

## CI

Manual workflow: `.github/workflows/e2e.yml` (deploy PullPreview, run Playwright, optional keep-on-failure).

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `E2E_ENV` | Target environment | `local` |
| `OPENPROJECT_HOST` | OpenProject hostname | per-env default |
| `NEXTCLOUD_HOST` | Nextcloud hostname | per-env default |
| `KEYCLOAK_HOST` | Keycloak hostname | per-env default |
| `E2E_OP_ADMIN_USER/PASS` | OpenProject admin credentials | `admin/admin` |
| `E2E_NC_ADMIN_USER/PASS` | Nextcloud admin credentials | `admin/admin` |
| `E2E_KC_ADMIN_USER/PASS` | Keycloak admin credentials | `admin/admin` |
| `E2E_ALICE_USER/PASS` | Realm user alice | `alice/1234` |
| `E2E_BRIAN_USER/PASS` | Realm user brian | `brian/1234` |
| `E2E_WORKERS` | Worker count | `1` |
| `SETUP_JOB_CHECK` | Wait for K8s setup-job | `false` |
| `SQUASH_TM_URL` | Squash TM base URL for result import | `https://squashtm.openproject.org/squash` |
| `SQUASH_TM_API_TOKEN` | Squash TM API token for result import | none |
| `SQUASH_TM_ITERATION_ID` | Target Squash TM iteration ID | none |
| `SQUASH_TM_SYNC_TEST_PLAN` | Add mapped test case IDs to the iteration before import | `false` |
| `SQUASH_TM_IMPORT_STEPS` | Import Playwright `test.step()` results as Squash `test_steps` | `false` |
| `SQUASH_TM_VALIDATE_STEP_COUNT` | Compare Playwright step count to Squash TM manual steps via API | `false` |
| `SQUASH_TM_STRICT_STEP_COUNT` | Fail publish on step count mismatch | `false` |
| `SQUASH_TM_DRY_RUN` | Write Squash payload without publishing | `false` |
| `SQUASH_TM_TEST_ATTACHMENT_EXTENSIONS` | Allowed per-test attachment extensions for Squash payloads | `txt,html,xml,doc,png,jpg,jpeg,webm,zip` |

Put variables in `.env.local` for local runs. Place `opnc-root-ca.crt` in the project root for self-signed CA.
