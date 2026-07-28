---
name: playwright-test-authoring
description: Goal-based routing between Playwright CLI+SKILLS and Playwright MCP when authoring E2E tests. Committed tests still follow openproject-e2e.md.
---

# Playwright Test Authoring (CLI vs MCP)

Canonical source for:

- `.cursor/rules/playwright-test-authoring.mdc`
- `.agents/skills/playwright-test-authoring/SKILL.md`
- `.claude/skills/playwright-test-authoring/SKILL.md`

Selector doctrine, POM, Squash, logging: [`.agents/shared/openproject-e2e.md`](openproject-e2e.md). This file only routes **browser discovery** and the **authoring order**.

Upstream:

- CLI: https://github.com/microsoft/playwright-cli
- MCP: https://github.com/microsoft/playwright-mcp

Microsoft’s split: coding agents usually prefer **CLI + SKILLS** (token-efficient; avoids large MCP schemas and verbose a11y trees in context). **MCP** fits specialized loops that need persistent browser state, rich introspection, or long iterative page reasoning (deep explore, self-heal, autonomous multi-step). Playwright MCP requires Cursor user/global setup when used (see `AGENTS.md`); pick the surface that matches the job.

## Goal → surface

| Job | Surface |
|-----|---------|
| Bulk / routine harvest while editing a large e2e tree | CLI + [playwright-cli skill](playwright-cli/SKILL.md) |
| Unknown / unstable UI; iterative DOM reasoning | MCP (`user-playwright`) |
| Self-heal after a failed `npx playwright test` needs live DOM | MCP (escalate if CLI was first) |
| Long multi-step exploratory session | MCP |
| Locators + page objects already cover the flow | Neither — reuse |

**Default:** CLI. **Escalate to MCP** only with a named reason: locator miss after CLI, auth wall needing persistent context, flake self-heal needing live introspection, multi-step stateful explore.

**Exclusive claim:** one browser surface owns the session segment. Do not run MCP and CLI in parallel on the same page. Switching requires naming the failure class above.

## Authoring steps (0–6)

0. Grep `e2e/pageobjects/` and `e2e/locators/` — extend existing before inventing.
1. Classify the job; **lock** CLI or MCP (or neither).
2. Explore only on the locked surface (CLI skill or Cursor Playwright MCP tools).
3. Land selectors only in `e2e/locators/*.json` (`by` / `value` per `utils/locators_guide.md`).
4. Wire or extend a page object via `getLocator(...)`. Prefer existing POs.
5. Spec calls page methods; Squash-mapped tests use `squashTestCase` + `test.step` alignment. Never paste MCP/CLI `page.*` into `e2e/tests/`.
6. `npx playwright test <file>` from `e2e/`. On fail: fix via locked surface or escalate with a named stockout. Cap **≤3** fix loops total across both tools; then stop and report.

### Preflight (YES before edits)

- Target flow / Squash ID known (if applicable)?
- Existing PO/locator reuse checked?
- Surface locked?
- Landing path is locators → pageobject → spec?

### Self-grep before finish

Fail closed if the diff introduces: raw `page.getBy*` / `page.locator` / `page.click` / `page.fill` in `e2e/tests/`; imports or paths under `pages/` (repo uses `e2e/pageobjects/`); dumped MCP/CLI transcripts in committed files.

## Failure stories → required move

1. **Always-MCP** burns the context window → default CLI; MCP only on named stockout.
2. **Always-CLI** when the failure needs live multi-step DOM chase → escalate to MCP with that reason.
3. **Thrash both** on one page → exclusive instrument claim.
4. **Paste tool output into specs** → map to locator JSON + `getLocator` + page method.
5. **Twin page object / invent selectors** → grep first; then inspect; then one new key if needed.

## Non-goals

- Neither CLI nor MCP is a CI runtime; committed runs use `npx playwright test` / `e2e/run-tests.sh`.
- No second selector hierarchy here — openproject-e2e owns that.
- Tool transcripts are ephemeral scratch, not merge artifacts.
