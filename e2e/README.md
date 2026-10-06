# E2E Integration Tests

Playwright tests for OpenProject / Nextcloud / Keycloak. Stack setup: root `README.md`.

## Run

```bash
# Docker
./run-tests.sh

# Native
npm install && npm run playwright:install
E2E_ENV=local npx playwright test
```

Useful filters:

```bash
E2E_ENV=local npx playwright test tests/opncintegration/
E2E_ENV=local npx playwright test --project=mcp-tests
E2E_ENV=local npx playwright test --grep @mcp
```

Set hosts/creds in `.env.local` if needed. Trust `opnc-root-ca.crt` at the repo root for local TLS.

Videos are recorded for UI tests (not MCP) and appear in the Playwright HTML report. They are not published to Squash. Disable with `E2E_VIDEO=off`.

## Conventions

See `.agents/shared/openproject-e2e.md` (selectors in `locators/`, page objects, logger, `squashTestCase`).

## MCP

| Suite | Path | Notes |
|-------|------|--------|
| Playwright | `tests/mcp/` | Live HTTP/auth/tools smoke; needs `mcp.enabled` + setup-job |
| mcp-eval | `mcp-eval/` | LLM agent eval (Python); see `mcp-eval/` and `.github/workflows/mcp-eval.yml` |

Default MCP token: `bob_ai_mcp_test_token_1234567890` (`MCP_OAUTH_TOKEN` / `MCP_BEARER_TOKEN`).

## CI

- Playwright: `.github/workflows/e2e.yml`
- mcp-eval: `.github/workflows/mcp-eval.yml`

Squash publish (optional): `npm run squash:publish` with `SQUASH_TM_API_TOKEN` + `SQUASH_TM_ITERATION_ID`.
