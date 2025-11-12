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

### Setup Job (WIP)
```bash
# Wait for setup-job to complete (automatic by default)
npm run wait-for-setup
```

## Configuration

Tests read from `environments/default/config.yaml`:
- `integration.setupMethod`: `oauth2`, `sso-nextcloud`, or `sso-external`

**Override via environment variable:**
```bash
SETUP_METHOD=oauth2 npm run test:e2e
```

## Test Organization

Tests are organized by setup method:
- `tests/oauth2/` - OAuth2 integration tests
- `tests/sso-nextcloud/` - SSO with Nextcloud Hub tests
- `tests/sso-external/` - SSO with Keycloak tests

**Note:** Only tests matching the current `setupMethod` will run. Others are automatically skipped.

## Environment Variables

Optional overrides:
```bash
export OPENPROJECT_URL=https://openproject.test
export NEXTCLOUD_URL=https://nextcloud.test
export KEYCLOAK_URL=https://keycloak.test
export SETUP_METHOD=oauth2
```


**Tests fail to connect?**
- Verify pods are running: `kubectl get pods -n opnc-integration`
- Check port forwarding is active

**Skip setup-job check:**
```bash
SKIP_SETUP_JOB_CHECK=true npm run test:e2e
```

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
