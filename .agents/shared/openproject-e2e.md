---
name: tests
description: E2E test conventions for OpenProject integration tests. Use when writing, modifying, or reviewing Playwright tests, page objects, utilities, or locators in this repository.
---

# OpenProject E2E Tests Skill

Canonical source for:

- `.cursor/rules/openproject-e2e.mdc`
- `.agents/skills/tests/SKILL.md`
- `.claude/skills/tests/SKILL.md`
- root `AGENTS.md` E2E summary

## Architecture Overview

The Playwright project lives under `e2e/` in this repository. Paths below are **relative to `e2e/`**.

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

```json
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
- Do not put UI flows (navigations, clicks, form fills) in `utils/test-helpers.ts`; move them into page objects.
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
- **`utils/test-helpers.ts`** must contain only API-specific helpers and orchestration that combines API checks with page objects for UI fallback:
  - API helpers: `ensureUserIsAdmin`, `ensureProjectExists`, `getProjectStorages`, `ensureProjectHasNoNextcloudStorage`.
  - Orchestration: `ensureProjectHasNextcloudStorage` (API checks + optional UI via `OpenProjectProjectStoragesPage`).
- **`utils/openproject-api.ts`** for direct API interactions with OpenProject (projects, users, storages).
- **UI flows** belong in page objects, not test-helpers:
  - `OpenProjectHomePage.copyDemoProjectViaUi(newIdentifier)` – copy demo project via UI.
  - `OpenProjectProjectStoragesPage.navigateTo(identifier)`, `addNextcloudStorage()`, `hasNextcloudStorage()` – project storages UI.
- When adding new cross-test flows:
  - Prefer page objects for UI flows; use test-helpers only for API or orchestration.
- After UI actions that should succeed, verify the expected UI feedback:
  - Example: after adding Nextcloud storage from OpenProject, wait for the success banner (`storageCreationSuccessMessage` locator, text `"Successful creation."`).

## OpenProject/Nextcloud Integration Notes

- SSO-created users may not exist in OpenProject until they complete a browser login. For admin-dependent OpenProject flows, log in via Keycloak first, then grant admin via `ensureUserIsAdmin`; if the admin flag changed, reload the page before continuing so the current session receives the new permissions.
- OpenProject may store the SSO user login as an email (e.g. `alice@example.com`) even when Keycloak login uses the short username (`alice`). Helpers that locate users should prefer the configured username but fall back to `TestUser.email` and other known aliases when needed.
- OpenProject file links and Nextcloud WebDAV files have separate cleanup paths. Deleting `OpenProject/<project folder>/<file>` from Nextcloud does not remove `/api/v3/file_links` records from the work package. Repeatable upload/link tests should delete stale OpenProject file links by work package and file name before uploading, and clean them again in `afterAll`.
- Files-tab hover actions can be icon-only. In OpenProject 17.3, the linked-file actions observed are: download via `/download`, open location with accessible name `"Open file in location"`, and unlink with accessible name `"Remove file link"`. Prefer locator keys/page-object helpers for these actions and avoid clicking destructive actions in availability-only tests.

## Squash TM Reporting

- Squash TM result import maps Playwright results through the test's automated test reference, and this repository stores that mapping in Playwright annotations.
- When a Playwright test corresponds to a Squash TM test case, add `squashTestCase(...)` from `utils/squash-metadata.ts` to the test declaration. The first argument is the numeric Squash test case ID.
- Use `squashTestCase(2148, { tag: ['@smoke'] })` when a mapped test also needs Playwright tags. Playwright accepts one details object per test, so do not add a second custom metadata object.
- The publisher derives the automated reference from the Playwright report as `integration-qa-helmfile/<spec folder>#<spec file>#<test title>`. Set the same value in Squash TM's automated test reference field.
- Squash test case, campaign, and iteration IDs are numeric Squash API IDs. Do not invent these IDs from date/time, `@smoke`, `@regression`, GitHub run ID, or other labels; use those values in generated names/descriptions instead.
- If a Squash-mapped test is renamed or moved, update the Squash TM automated test reference to match the new generated reference.
- CI publishing uses `npm run squash:publish` after Playwright has produced `playwright-report/run-*/results.json`. Publishing needs `SQUASH_TM_API_TOKEN` and either `SQUASH_TM_ITERATION_ID` or a future campaign-based iteration creation flow.

### Per-test step results (Playwright `test.step()`)

Squash TM import supports `tests[].test_steps[]` with per-step status and attachments. The API matches steps **by position**: the number of imported steps must equal the number of manual steps on the Squash test case (see [import from pipelines](https://tm-en.doc.squashtest.com/latest/user-guide/manage-automated-tests/devops/importResultsFromPipeline.html)).

- Enable in CI with `SQUASH_TM_IMPORT_STEPS=true` (set in `.github/workflows/e2e.yml`).
- Use **top-level** `test.step('...', async () => { ... })` only; do not rely on nested steps for Squash alignment.
- Pass `stepCount: N` in `squashTestCase(...)` where `N` is the Squash manual step count. The publisher validates Playwright step count against this annotation and, when `SQUASH_TM_VALIDATE_STEP_COUNT=true`, against Squash TM via API.
- On mismatch, the publisher logs a warning and omits `test_steps` for that test (unless `SQUASH_TM_STRICT_STEP_COUNT=true`).
- When step import is enabled, suite-level `junit.xml` is not attached (per-test results and step attachments are used instead). `github-run.txt` remains at suite level.
- Squash manual steps must be defined in the same order as Playwright `test.step()` blocks.

Example:

```ts
import { squashTestCase } from '../../utils/squash-metadata';

test(
  'OpenProject Files tab lists linked Nextcloud items and available actions',
  squashTestCase(2148, { stepCount: 4 }),
  async ({ page }) => {
    await test.step('Login to OpenProject as the test user', async () => {
      // ...
    });
    await test.step('Open the target work package', async () => {
      // ...
    });
    await test.step('Open the Files tab', async () => {
      // ...
    });
    await test.step('Hover over a linked file', async () => {
      // ...
    });
  }
);
```

## Running Tests

- Tests run in headless mode by default (see `playwright.config.ts`).
- To run in headed mode, use Playwright’s native CLI flags, e.g.:
  - `npx playwright test --headed`
- Default worker configuration:
  - Single worker (`workers: 1`), overridable via `E2E_WORKERS` or `--workers`.
- **Native (Node.js on host):**
  - Run tests: `npx playwright test`
  - Run tests headed: `npx playwright test --headed`
  - Run tests and open report: `npx playwright test && npx playwright show-report`
- **Docker (zero local Node/browser):**
  - Run all tests: `./run-tests.sh` (default `E2E_ENV=local`)
  - Target env: `E2E_ENV=edge ./run-tests.sh` or `E2E_ENV=stage ./run-tests.sh`
  - Pass Playwright args: `./run-tests.sh --grep @smoke`; force rebuild: `./run-tests.sh --build`
  - Reports and traces are bind-mounted to `playwright-report/` and `test-results/` on the host.

## Optional: Playwright CLI

The `playwright-cli` tool is for **interactive** exploration against a live site: snapshots, optional tracing or video outside the normal `npx playwright test` run, and discovering selector strategies. Output lines that look like Playwright API calls are **hints** for locator design, not something to paste into this repo’s specs.

- **Install / run:** use `playwright-cli` if installed globally; otherwise `npx playwright-cli` (see `.agents/shared/playwright-cli/SKILL.md` under "Local installation").
- **Useful commands (subset):** `open`, `goto`, `snapshot`, `click`, `fill`, `close`; `tracing-start` / `tracing-stop`; `video-start` / `video-stop`; named sessions `-s=name`, `list`, `close-all`.
- **Full command reference:** `.agents/shared/playwright-cli/SKILL.md` and `.agents/shared/playwright-cli/references/`.

**This repository:** do not put raw selectors or CLI-generated `page.*` lines into `tests/`. Add stable keys to `locators/*.json`, use `getLocator` in page objects, and call page object methods from specs (see Locator Rules and Page Object Conventions above).

## Writing Style

- Keep all documentation, comments, and README files short and precise.
- No emojis, no decorative characters, no redundant explanations.
- Only comment non-obvious logic; do not narrate what the code does.

## Self-Improvement Directive

- After significant refactoring or architectural changes, update this `SKILL.md` to reflect new conventions.
- Keep this file concise and focused on project-specific knowledge.
