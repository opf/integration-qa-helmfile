# E2E Integration Tests

Playwright end-to-end tests for OpenProject-Nextcloud-Keycloak integration.

## Requirements

- Node.js 18+
- npm
- Kubernetes cluster with deployed integration (OpenProject, Nextcloud, Keycloak)
- Playwright browsers installed

## Quick Start

1. **Install dependencies:**
   ```bash
   cd e2e
   npm install
   npm run playwright:install
   ```

2. **Run tests:**
   ```bash
   npm run test:e2e
   ```

## Commands

### Run Tests
```bash
# Run all tests in both browsers (Chromium + Firefox)
npm run test:e2e

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run in specific browser
npm run test:e2e:chromium
npm run test:e2e:firefox

# Run with UI mode (interactive)
npm run test:e2e:ui
```

### View Results
```bash
# Open test report
npm run report:show
```

### Select tests by tag
```bash
# Run only smoke tests
npx playwright test --grep @smoke

# Run regression (includes smoke)
npx playwright test --grep @regression

# Run integration-only tests (exclude smoke)
npx playwright test --grep @integration --grep-invert @smoke
```

## Test Organization & Tags

Tests are organized by setup method:
- `tests/oauth2/` - OAuth2 integration tests (`@regression @integration`, some `@smoke`)
- `tests/sso-nextcloud/` - SSO with Nextcloud Hub tests (`@regression @integration`, some `@smoke`)
- `tests/sso-external/` - SSO with Keycloak tests (`@regression @integration`, some `@smoke`)

Only tests matching the current `setupMethod` will run; others are skipped. Use `--grep` to target `@smoke`, `@regression`, or `@integration`.

## Test Users

Defaults (overridable via env):
- OpenProject admin: `E2E_OP_ADMIN_USER` / `E2E_OP_ADMIN_PASS` (default `admin/admin`)
- Nextcloud admin: `E2E_NC_ADMIN_USER` / `E2E_NC_ADMIN_PASS` (default `admin/admin`)
- Keycloak admin: `E2E_KC_ADMIN_USER` / `E2E_KC_ADMIN_PASS` (default `admin/admin`)
- Keycloak realm users: `E2E_ALICE_USER` / `E2E_ALICE_PASS` (default `alice/1234`), `E2E_BRIAN_USER` / `E2E_BRIAN_PASS` (default `brian/1234`)

Import from `e2e/utils/test-users.ts`:

```typescript
import { OP_ADMIN_USER, NC_ADMIN_USER, ADMIN_USER, ALICE_USER, BRIAN_USER } from '../utils/test-users';
```

## Environment Variables

Core URLs (hosts):\
`OPENPROJECT_URL`, `NEXTCLOUD_URL`, `KEYCLOAK_URL`

Credentials (see Test Users):\
`E2E_OP_ADMIN_USER`, `E2E_OP_ADMIN_PASS`, `E2E_NC_ADMIN_USER`, `E2E_NC_ADMIN_PASS`, `E2E_KC_ADMIN_USER`, `E2E_KC_ADMIN_PASS`, `E2E_ALICE_USER`, `E2E_ALICE_PASS`, `E2E_BRIAN_USER`, `E2E_BRIAN_PASS`

Other controls:\
`SETUP_METHOD` (`oauth2`, `sso-nextcloud`, `sso-external`), `SKIP_SETUP_JOB_CHECK=true` to bypass cluster setup waits

If `environments/default/config.yaml` is not present (e.g., CI), env vars fully drive configuration.

**Tests fail to connect?**
- Verify pods are running: `kubectl get pods -n opnc-integration`
- Check port forwarding is active

## Project Structure

```
e2e/
├── tests/              # Test files by setup method
├── pageobjects/        # Page Object Model classes
├── locators/           # JSON locator definitions
├── utils/              # Utilities (config, locator-resolver, etc.)
└── playwright.config.ts
```

## More Information

- Tests run in parallel by default (both browsers + multiple test files)
- Uses Page Object Model pattern
- Locators stored in JSON files
- See `e2e/utils/locators_guide.md` for locator usage examples

## GitHub Actions (CI)

A workflow at `.github/workflows/e2e.yml` runs Playwright on pushes/PRs to `dev` and `release`.

Secrets expected:
- `E2E_EDGE_OPENPROJECT_URL`, `E2E_EDGE_NEXTCLOUD_URL`, `E2E_EDGE_KEYCLOAK_URL`
- `E2E_STAGE_OPENPROJECT_URL`, `E2E_STAGE_NEXTCLOUD_URL`, `E2E_STAGE_KEYCLOAK_URL`
- `E2E_EDGE_OP_ADMIN_USER/PASS`, `E2E_STAGE_OP_ADMIN_USER/PASS`
- `E2E_EDGE_NC_ADMIN_USER/PASS`, `E2E_STAGE_NC_ADMIN_USER/PASS`
- `E2E_EDGE_KC_ADMIN_USER/PASS`, `E2E_STAGE_KC_ADMIN_USER/PASS`

Branch rules:
- `dev` → edge environment (`e2e.openproject-edge.com`)
- `release` → stage environment (`e2e.openproject-stage.com`)

Local override example:
```bash
OPENPROJECT_URL=https://e2e.openproject-edge.com \
NEXTCLOUD_URL=https://... \
KEYCLOAK_URL=https://... \
SETUP_METHOD=oauth2 \
E2E_OP_ADMIN_USER=... E2E_OP_ADMIN_PASS=... \
npm run test:e2e -- --grep @smoke
```
