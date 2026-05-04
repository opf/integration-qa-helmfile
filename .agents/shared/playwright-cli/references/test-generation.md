# Test Generation

Generate Playwright test code automatically as you interact with the browser.

## Playwright E2E project in this repository

In this repository, the committed Playwright project lives under `e2e/`, and tests must follow `.agents/shared/openproject-e2e.md`: selectors live in `locators/*.json`, interactions in page objects via `getLocator(key)`, and specs call page methods. The CLI output is a **hint** for which `by`/`value` to store under a stable key, not a spec to paste verbatim. Skip to [In this repository](#in-this-repository-building-tests) below.

## How It Works

Every action you perform with `playwright-cli` generates corresponding Playwright TypeScript lines in the output. In generic projects you may copy those into tests; in this repository you **map** them to locators and page objects instead.

## Example Workflow

```bash
# Start a session
playwright-cli open https://example.com/login

# Take a snapshot to see elements
playwright-cli snapshot
# Output shows: e1 [textbox "Email"], e2 [textbox "Password"], e3 [button "Sign In"]

# Fill form fields - generates code automatically
playwright-cli fill e1 "user@example.com"
# Ran Playwright code:
# await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');

playwright-cli fill e2 "password123"
# Ran Playwright code:
# await page.getByRole('textbox', { name: 'Password' }).fill('password123');

playwright-cli click e3
# Ran Playwright code:
# await page.getByRole('button', { name: 'Sign In' }).click();
```

## Generic Playwright test (other codebases)

Outside this repo, you might assemble a test like this:

```typescript
import { test, expect } from '@playwright/test';

test('login flow', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('user@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('password123');
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/.*dashboard/);
});
```

## In this repository: building tests

Do **not** put the generated `page.getByRole(...)` (or other) chains directly in `tests/*.spec.ts`.

1. From the CLI output, note the semantic strategy (e.g. `getByRole` + name).
2. Add a **stable key** in the right JSON file (`openproject.json`, `nextcloud.json`, or `keycloak.json`) with the matching `by` and `value` (see `utils/locators_guide.md`).
3. Implement a **page object** method that uses `getLocator('yourKey')` and performs the action.
4. In the spec, call that page object method and assert using locators or expectations consistent with project conventions.

Conceptually: CLI suggests `await page.getByRole(...)` → you store the same intent under `selectors.loginEmail` (example key) and call `await this.getLocator('loginEmail').fill(...)` in a page class.

## Best Practices

### 1. Use Semantic Locators

The generated code uses role-based locators when possible, which are more resilient. When translating to JSON, preserve that strategy (same `by`/`value` shape as the generated line).

```typescript
// CLI output (good - semantic) informs locator JSON + page object
// Avoid committing raw CSS in specs: await page.locator('#submit-btn').click();
```

### 2. Explore Before Recording

Take snapshots to understand the page structure before recording actions:

```bash
playwright-cli open https://example.com
playwright-cli snapshot
# Review the element structure
playwright-cli click e5
```

### 3. Add Assertions Manually

Generated code captures actions but not assertions. Add expectations in your test (or page object). In this repo, use locators from JSON for visibility checks where applicable.

```typescript
// After mapping to page object + locators:
// await expect(pageObject.getLocator('successMessage')).toBeVisible();
```
