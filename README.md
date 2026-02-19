# E2E Integration Tests

Playwright E2E tests for OpenProject, Nextcloud, and Keycloak integration.

## Requirements

- Docker (for Docker-based runs), or Node.js (see `.node-version`) and npm for native runs
- Integration cluster via [opf/integration-qa-helmfile](https://github.com/opf/integration-qa-helmfile)

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

For more run options (envs, tags, report), see `.cursor/skills/tests/SKILL.md`.

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
