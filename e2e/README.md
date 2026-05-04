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

**E2E conventions and runs:** `.agents/shared/openproject-e2e.md` (thin adapters: Cursor `.cursor/skills/tests/SKILL.md`, `.cursor/rules/openproject-e2e.mdc`; Codex `.agents/skills/tests/SKILL.md`; Claude `.claude/skills/tests/SKILL.md`).

**`playwright-cli`** (interactive only; not `npx playwright test`): `.claude/skills/playwright-cli/SKILL.md` or `.agents/skills/playwright-cli/SKILL.md` · `.claude/skills/playwright-cli/references/`.

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

Put variables in `.env.local` for local runs. Place `opnc-root-ca.crt` in the project root for self-signed CA.
