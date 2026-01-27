# E2E Integration Tests

Playwright end-to-end tests for OpenProject-Nextcloud-Keycloak integration.

## Requirements

- Node.js 18+
- npm
- Integration cluster deployed via https://github.com/opf/integration-qa-helmfile
- Playwright browsers installed

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   npm run playwright:install
   ```

2. **Set env for local (gitignored):**
   ```bash
   cat > .env.local <<'EOF'
   OPENPROJECT_HOST=openproject.test
   NEXTCLOUD_HOST=nextcloud.test
   KEYCLOAK_HOST=keycloak.test
   E2E_OP_ADMIN_USER=admin
   E2E_OP_ADMIN_PASS=admin
   E2E_NC_ADMIN_USER=admin
   E2E_NC_ADMIN_PASS=admin
   E2E_KC_ADMIN_USER=admin
   E2E_KC_ADMIN_PASS=admin
   EOF
   ```

3. **Run tests (choose env):**
   ```bash
   E2E_ENV=local npm test        # local Helm/defaults
   E2E_ENV=edge npm test         # edge/staging secrets must be exported
   E2E_ENV=stage npm test        # stage secrets must be exported
   ```

## Commands

### Run Tests
```bash
# Run with explicit env selection (preferred)
E2E_ENV=edge npm test
E2E_ENV=stage npm test
E2E_ENV=local npm test

# Override worker count to re-enable parallelism (default is 1)
npx playwright test --workers 4

# Shortcuts
npm run test:edge     # uses E2E_ENV=edge
npm run test:stage    # uses E2E_ENV=stage
npm run test:local    # uses E2E_ENV=local

# Run in headed mode
npm run test:e2e:headed

# Run with UI mode
npm run test:e2e:ui
```

### View Results
```bash
# Open test report
npm run report:show
```

### Run Tests by Tag

Use `--grep` to include tags:
```bash
npx playwright test --grep @fast
```

Skip a tag with `--grep-invert`:
```bash
npx playwright test --grep-invert @fast
```

Logical OR (either tag):
```bash
npx playwright test --grep "@fast|@slow"
```

Logical AND (both tags via lookahead):
```bash
npx playwright test --grep "(?=.*@fast)(?=.*@slow)"
```

## Test Organization & Tags

All tests now live directly under `tests/`:
- `kc-integration.spec.ts` - Keycloak integration (`@smoke`, `@regression`, `@integration`)
- `nc-integration.spec.ts` - Nextcloud integration (`@regression`, `@integration`)
- `op-integration.spec.ts` - OpenProject integration (`@regression`, `@integration`)

All specs run for the single supported setup (`sso-external`). Use `--grep` to target `@smoke`, `@regression`, or `@integration`.

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

Hosts (preferred):\
`OPENPROJECT_HOST`, `NEXTCLOUD_HOST`, `KEYCLOAK_HOST`

Versions (optional):\
`OPENPROJECT_VERSION`, `NEXTCLOUD_VERSION`, `INTEGRATION_APP_VERSION`, `KEYCLOAK_VERSION`

Credentials (see Test Users):\
`E2E_OP_ADMIN_USER`, `E2E_OP_ADMIN_PASS`, `E2E_NC_ADMIN_USER`, `E2E_NC_ADMIN_PASS`, `E2E_KC_ADMIN_USER`, `E2E_KC_ADMIN_PASS`, `E2E_ALICE_USER`, `E2E_ALICE_PASS`, `E2E_BRIAN_USER`, `E2E_BRIAN_PASS`

Other controls:\
`SETUP_METHOD` (`sso-external` only), `SETUP_JOB_CHECK=true` to enforce cluster setup-job wait (off by default), `E2E_ENV` to pick env preset.

Local runs: put the above in `.env.local` (already gitignored). CI ignores this file.

**Tests fail to connect?**
- Verify pods are running: `kubectl get pods -n opnc-integration`
- Check port forwarding is active

**Playwright complains about missing browser executable?**
- Make sure you've run `npm run playwright:install` (or `npx playwright install`) after `npm install`.
- Re-run your test command, e.g. `npm run test:local`.

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

Workflow `.github/workflows/e2e.yml`:
- Trigger: push/PR to `dev`/`release`, or manual `workflow_dispatch`.
- Input `environment`: `edge`, `stage`, or `local`.
- Secrets required per env:
  - Hosts: `E2E_EDGE_OPENPROJECT_HOST`, `E2E_EDGE_NEXTCLOUD_HOST`, `E2E_EDGE_KEYCLOAK_HOST` (and `E2E_STAGE_*`, `E2E_LOCAL_*` if used in CI)
  - Versions: `E2E_EDGE_OPENPROJECT_VERSION`, `E2E_EDGE_NEXTCLOUD_VERSION`, `E2E_EDGE_INTEGRATION_APP_VERSION`, `E2E_EDGE_KEYCLOAK_VERSION` (stage/local variants as needed)
  - Admin creds: `E2E_EDGE_OP_ADMIN_USER/PASS`, `E2E_EDGE_NC_ADMIN_USER/PASS`, `E2E_EDGE_KC_ADMIN_USER/PASS` (stage/local variants as needed)
- The workflow exports env vars and runs: `npx playwright test -- --env <env> [--grep ...]`.

Local override example:
```bash
OPENPROJECT_HOST=openproject.test \
NEXTCLOUD_HOST=nextcloud.test \
KEYCLOAK_HOST=keycloak.test \
SETUP_METHOD=sso-external \
E2E_OP_ADMIN_USER=admin E2E_OP_ADMIN_PASS=admin \
npm test -- --env local --grep @smoke
```