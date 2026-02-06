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

2. **Ensure local integration cluster is running (for local tests):**
   The recommended way to run a full local OpenProject–Nextcloud–Keycloak stack is via the
   [`opf/integration-qa-helmfile`](https://github.com/opf/integration-qa-helmfile/tree/main) repo.
   Follow its README to `make setup` and `make deploy`, which will provision:
   - `https://openproject.test`
   - `https://nextcloud.test`
   - `https://keycloak.test`

3. **Run tests (native Playwright, headless by default):**
   ```bash
   E2E_ENV=local npx playwright test        # local Helm/defaults
   E2E_ENV=edge npx playwright test         # edge/staging secrets must be exported
   E2E_ENV=stage npx playwright test        # stage secrets must be exported
   ```

## Commands

### Run Tests
```bash
# Native Playwright (recommended)
E2E_ENV=local npx playwright test
E2E_ENV=edge npx playwright test
E2E_ENV=stage npx playwright test

# Run tests and automatically open HTML report
E2E_ENV=local npx playwright test && npx playwright show-report

# Override worker count to re-enable parallelism (default is 1)
npx playwright test --workers 4

# npm script shortcuts (thin wrappers around the above)
npm run test:edge     # uses E2E_ENV=edge
npm run test:stage    # uses E2E_ENV=stage
npm run test:local    # uses E2E_ENV=local

# Run in headed mode (non-headless)
npm run test:e2e:headed     
npx playwright test --headed

# Run with UI mode
npm run test:e2e:ui
```

### View Results
```bash
# Open last test report (native)
npx playwright show-report

# Or via npm script
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

## Test Helpers

Use the helpers in `utils/test-helpers.ts` to keep specs focused on behaviour instead of data setup:

- Ensure a user has admin rights (idempotent):

```typescript
import { ensureUserIsAdmin } from '../utils/test-helpers';

const loginIdentifier = ALICE_USER.email ?? `${ALICE_USER.username}@example.com`;
const { userId, updated } = await ensureUserIsAdmin(loginIdentifier);
```

- Ensure a project exists and has a Nextcloud storage configured via API:

```typescript
import { ensureProjectHasNextcloudStorage } from '../utils/test-helpers';

await ensureProjectHasNextcloudStorage('demo-project');
```

- Copy the demo project via UI using page objects:

```typescript
import { OpenProjectHomePage } from '../pageobjects/openproject';

const homePage = new OpenProjectHomePage(page);
await homePage.copyDemoProjectViaUi('test');
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
- Re-run your test command, e.g. `E2E_ENV=local npx playwright test`.

## More Information

- Tests run with a single worker by default (configurable via `--workers`)
- Uses Page Object Model pattern
- Locators stored in JSON files
- See `e2e/utils/locators_guide.md` for locator usage examples

