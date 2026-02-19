# E2E Integration Tests

Playwright E2E tests for OpenProject, Nextcloud, and Keycloak integration.

## Requirements

- Docker (for Docker-based runs), or Node.js 18+ and npm (for native runs)
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

## Running Tests

### Docker

```bash
./run-tests.sh                    # local, all tests
E2E_ENV=edge ./run-tests.sh       # edge environment
E2E_ENV=stage ./run-tests.sh      # stage environment
./run-tests.sh --grep @smoke      # filter by tag
./run-tests.sh --build            # force image rebuild
./run-tests.sh --no-open-report   # skip opening report in browser after run
```

Report opens on your machine after the run. Each run writes to `playwright-report/run-YYYY-MM-DD_HH-mm-ss/` (report in `report/`, plus `results.json`, `junit.xml`). Traces/screenshots/videos stay in `test-results/`. Config is mounted so changes to `playwright.config.ts` apply without rebuilding the image; use `--build` only when deps or Dockerfile change.

Credentials and host overrides go in `.env.local` (gitignored, loaded automatically). If `opnc-root-ca.crt` is in the project root it is mounted and used automatically for self-signed CA.

### Native

```bash
E2E_ENV=local npx playwright test
E2E_ENV=edge npx playwright test
E2E_ENV=stage npx playwright test
npx playwright test --headed
npx playwright test --workers 4
npx playwright show-report
npm run test:e2e:report          # run tests then open report (native)
```

npm shortcuts: `npm run test:local`, `test:edge`, `test:stage`, `test:docker`, `report:show`.

**Report:** Docker: report opens automatically after `./run-tests.sh` (or open `playwright-report/index.html`). Native: `npm run report:show` serves at http://localhost:9323 (bound to 0.0.0.0).

### Tags

```bash
npx playwright test --grep @smoke
npx playwright test --grep "@smoke|@regression"
```

Tags in use: `@smoke`, `@regression`, `@integration`.

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

Put variables in `.env.local` for local runs.
