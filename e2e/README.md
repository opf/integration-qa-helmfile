# E2E Integration Tests

Playwright for OpenProject / Nextcloud / Keycloak. Stack: root `README.md`. Conventions: `.agents/shared/openproject-e2e.md`.

## Run (Docker only)

From `e2e/` (no host browsers):

```bash
./run-tests.sh                          # or: npm run test:docker
./run-tests.sh --build --no-open-report # after lockfile/Dockerfile changes
E2E_ENV=local ./run-tests.sh --no-open-report --project=op-integration-tests tests/…
```

PullPreview: set `E2E_ENV=pullpreview` plus `OPENPROJECT_HOST` / `NEXTCLOUD_HOST` / `KEYCLOAK_HOST`, then `./run-tests.sh --no-open-report …`.

Optional `.env.local`; local TLS uses repo-root `opnc-root-ca.crt` when present. Agents: always Docker + `--no-open-report`.

Videos: UI projects only, **retain-on-failure** (HTML report under `playwright-report/`; not Squash). Off: `E2E_VIDEO=off`. MCP project has video off.

## MCP / CI

| | |
|--|--|
| Playwright MCP smoke | `tests/mcp/` |
| LLM mcp-eval | `mcp-eval/` → `.github/workflows/mcp-eval.yml` |
| E2E CI | `.github/workflows/e2e.yml` |
| Squash | `npm run squash:publish` (`SQUASH_TM_API_TOKEN`, `SQUASH_TM_ITERATION_ID`) |
