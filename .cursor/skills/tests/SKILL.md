---
name: tests
description: E2E test conventions for OpenProject integration tests. Use when writing, modifying, or reviewing Playwright tests, page objects, utilities, or locators in this repository.
---

# OpenProject E2E Tests Skill

## Architecture Overview

- `tests/`: Playwright spec files (integration flows across OpenProject, Nextcloud, Keycloak).
- `pageobjects/`: Page Object Model classes wrapping UI interactions.
- `locators/`: JSON locator definitions for each product (`openproject.json`, `nextcloud.json`, `keycloak.json`).
- `utils/`: Shared helpers (config, env/hosts, API clients, error handling, logging, version detection, test helpers).
- `global-setup.ts`: Pre-test setup (Kubernetes setup-job wait, version detection, env var enrichment).
- `playwright.config.ts`: Playwright runner config (headless by default, workers, retries, etc.).

Page object inheritance:
- `BasePage` → domain base pages (`OpenProjectBasePage`, `NextcloudBasePage`, `KeycloakBasePage`) → concrete pages (Login, Home, Admin, etc.).

## Locator Rules

- Never put selectors directly into test code; always use locator rules and JSON files in `locators/`.
- Locator file structure:

```markdown
{
  "url": "https://example/",
  "selectors": {
    "loginButton": { "by": "getByRole", "value": { "role": "button", "name": "Login" } }
  }
}
```

- Prefer semantic locators: `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`, `getByTitle`.
- Use `getByTestId` when `data-testid` attributes are available.
- Use `locator` (CSS/XPath) only as a last resort when semantic selectors are not possible.
- Keep locator keys descriptive and stable (e.g., `usernameInput`, `projectSettingsButton`, `storageCreationSuccessMessage`).
- See `utils/locators_guide.md` for detailed locator patterns and supported `by` values.

## Page Object Conventions

- When adding a new test, first check if an existing page object can be reused or extended before creating a new one.
- All page objects must:
  - Extend the appropriate domain base page (`OpenProjectBasePage`, `NextcloudBasePage`, `KeycloakBasePage`) or `BasePage`.
  - Load locators via the base constructor using the correct locator JSON file.
  - Use `getLocator(key)` to resolve selectors; do not hardcode selectors inside page objects.
- Domain base pages:
  - `OpenProjectBasePage` uses `locators/openproject.json`.
  - `NextcloudBasePage` uses `locators/nextcloud.json`.
  - `KeycloakBasePage` uses `locators/keycloak.json`.
- Export page objects via `index.ts` barrel files per domain for consistent imports.
- Encapsulate complex flows in page methods rather than duplicating sequences in tests.

## Error Handling Standards

- Always use typed catches:

```ts
try {
  // ...
} catch (error: unknown) {
  logError("Something failed", getErrorMessage(error));
}
```

- Never use `catch (error: any)` or untyped `catch (error)` in new or modified code.
- Use `getErrorMessage(error)` from `utils/error-utils.ts` to safely extract an error message from unknown values.
- Avoid truly silent failures:
  - For expected fallbacks, at least log with `logDebug` or `logWarn`.
  - For unexpected failures, use `logError` and either rethrow or fail fast depending on context.

## Logging Standards

- Use the central logger from `utils/logger.ts`:
  - `logDebug(...)`
  - `logInfo(...)`
  - `logWarn(...)`
  - `logError(...)`
- Do not use `console.log`, `console.warn`, or `console.error` directly in tests, page objects, or utils.
- Log level is controlled by `E2E_LOG_LEVEL` (`debug`, `info`, `warn`, `error`) and defaults to `info`.
  - Use `logDebug` for verbose troubleshooting.
  - Use `logInfo` for high-level lifecycle information (start/end of major flows).
  - Use `logWarn` for recoverable issues and fallbacks.
  - Use `logError` for failures that should normally fail the run or require attention.

## Environment and Configuration

- Always resolve environment name and hosts via `utils/env-hosts.ts`:
  - `resolveEnvName()` chooses the environment (`local`, `edge`, `stage`, etc.) based on `E2E_ENV` or `ENV` (default: `local`).
  - `resolveHosts(envName?)` returns OpenProject, Nextcloud, and Keycloak hosts using env vars with per-env defaults.
- Do not duplicate host or environment resolution logic inside tests or helpers; always call the shared utilities.
- Configuration is loaded once in `utils/config.ts` and exposed as `testConfig`:
  - Service URLs and versions.
  - Setup method and environment name.
  - Any additional test-level configuration.
- `global-setup.ts`:
  - Optionally waits for Kubernetes `setup-job` completion when `SETUP_JOB_CHECK=true` (uses `utils/pod-waiter.ts`).
  - Runs `detectAllVersions()` from `utils/version-detect.ts` to populate version-related env vars (OpenProject, Nextcloud, Keycloak, etc.) if not already set.

## Type Safety

- Prefer explicit TypeScript interfaces and types for:
  - API responses (e.g., OpenProject v3, Nextcloud capabilities and status endpoints, Keycloak server info).
  - Config structures and helper return types.
- Avoid `Record<string, any>` and other untyped shapes in new or refactored code.
- Keep interfaces close to their usage (e.g., in `utils/version-detect.ts` for version APIs).

## Test Helpers and Reuse

- Use functions for repetitive actions so they can be reused later rather than copied into each spec.
- Shared helpers live primarily in:
  - `utils/test-helpers.ts` for high-level flows (e.g., `ensureProjectExists`, `ensureProjectHasNextcloudStorage`, `ensureDemoProjectCopyViaUi`).
  - `utils/openproject-api.ts` for direct API interactions with OpenProject (projects, users, storages).
- When adding new cross-test flows:
  - First, see if existing helpers can be extended.
  - If needed, create a new helper function with a clear name and parameters.
- After UI actions that should succeed, verify the expected UI feedback:
  - Example: after adding Nextcloud storage from OpenProject, wait for the success banner (`storageCreationSuccessMessage` locator, text `"Successful creation."`).

## Running Tests

- Tests run in headless mode by default (see `playwright.config.ts`).
- To run in headed mode, use Playwright’s native CLI flags, e.g.:
  - `npx playwright test --headed`
- Default worker configuration:
  - Single worker (`workers: 1`) to keep tests predictable and avoid cross-test interference.
- Common commands:
  - Run tests: `npx playwright test`
  - Run tests headed: `npx playwright test --headed`
  - Run tests and open report: `npx playwright test && npx playwright show-report`

## Self-Improvement Directive

- After completing significant refactoring, introducing new patterns, or making architectural changes to this E2E codebase:
  - Update this `SKILL.md` to reflect the new conventions, helpers, and standards.
  - Keep the file concise and focused on project-specific knowledge that future sessions should follow by default.

