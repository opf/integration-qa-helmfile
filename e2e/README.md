# E2E Integration Tests

Playwright E2E tests for OpenProject, Nextcloud, and Keycloak integration.

## Requirements

- Docker (for Docker-based runs), or Node.js (see `.node-version`) and npm for native runs
- Integration stack from this repository (see root `README.md`)

## Quick Start

**Docker (no local Node.js required):**
```bash
./run-tests.sh
```

**Native:**
```bash
npm install
npm run playwright:install
E2E_ENV=local npx playwright test
```

## Docs

**E2E conventions and runs:** `.agents/shared/openproject-e2e.md` (thin adapters: Cursor/Codex `.agents/skills/tests/SKILL.md`, Cursor `.cursor/rules/openproject-e2e.mdc`, Claude `.claude/skills/tests/SKILL.md`).

**`playwright-cli`** (interactive only; not `npx playwright test`): `.agents/shared/playwright-cli/SKILL.md` via thin adapters in `.agents/skills/playwright-cli/SKILL.md` and `.claude/skills/playwright-cli/SKILL.md`; references live under `.agents/shared/playwright-cli/references/`. For test debugging use `npx playwright test --debug=cli`; for trace analysis use `npx playwright trace …` (see tracing reference).

## CI

Manual workflows:

- Playwright (including MCP): `.github/workflows/e2e.yml` — set **suite** to `mcp` and **setupMethod** to `oauth2` (OpenProject only) or `sso-external` (OpenProject + Keycloak).
- LLM mcp-eval: `.github/workflows/mcp-eval.yml` — choose **llm_provider** (`llm-stack` or `openrouter`) and **llm_model** (curated list; default `provider-default`).

## MCP tests

MCP coverage is split across three layers:

| Layer | Where | What it proves |
|-------|--------|----------------|
| OpenProject RSpec | `openproject` repo (`spec/requests/mcp/…`) | Tool/resource correctness, auth scopes, permissions |
| Playwright `@mcp` | `tests/mcp/` | Live deploy smoke: Streamable HTTP, Bearer auth, list + call tools/resources |
| mcp-eval | `mcp-eval/` | LLM agent loop: tool selection, args, multi-step, guardrails |

Playwright MCP + mcp-eval are enough in this repo. Deep tool behavior stays in OpenProject RSpec. The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is optional for local debugging only (point it at `OPENPROJECT_URL/mcp` with the Bob_AI bearer token); it is not used in CI.

Both suites need a stack whose setup-job ran with `mcp.enabled: true` (chart default) so `setup-mcp.rb` seeded user `Bob_AI` and the Doorkeeper token. OpenProject-only is enough: `make deploy-op-standalone` with `integration.setupMethod: oauth2` (see `environments/override.yaml.example`). Wait for a `setup-job-*` pod to complete.

### Playwright (`tests/mcp`)

Protocol, auth, tools, and resources via the MCP SDK / `fetch`. Tagged `@mcp`; Playwright project `mcp-tests`. No LLM.

```bash
# Native
E2E_ENV=local npx playwright test --project=mcp-tests
E2E_ENV=local npx playwright test tests/mcp
E2E_ENV=local npx playwright test --grep @mcp

# Docker
./run-tests.sh --project=mcp-tests
```

Auth fallback is the seeded token `bob_ai_mcp_test_token_1234567890` (`mcp.oauthToken`). Override with `MCP_OAUTH_TOKEN` or `MCP_API_TOKEN`.

### mcp-eval (`mcp-eval/`)

Python LLM evaluation against a live MCP server (tool selection, multi-step, guardrails). Requires Python 3.10+ and an LLM API key. Trust the local CA (`opnc-root-ca.crt`) for `https://openproject.test`, or set `SSL_CERT_FILE` / `REQUESTS_CA_BUNDLE`.

Resolve provider presets with `.github/scripts/resolve-llm-provider.sh` (`llm-stack` default, or `openrouter`), then run:

```bash
cd mcp-eval
pip install -e .
export OPENPROJECT_URL=https://openproject.test
export MCP_BEARER_TOKEN=bob_ai_mcp_test_token_1234567890

# llm-stack (default)
export LLM_STACK_API_KEY=<key>
eval "$(../../.github/scripts/resolve-llm-provider.sh --export llm-stack)"

# or OpenRouter with a curated model id:
# export OPENROUTER_API_KEY=<key>
# export LLM_MODEL=openai/gpt-4o-mini
# eval "$(../../.github/scripts/resolve-llm-provider.sh --export openrouter)"

mcp-eval run tests/ --json reports/results.json --html reports/report.html
```

Or export `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` directly (see `mcpeval.yaml`).

CI writes `reports/run-metadata.json` (provider, model, base URL, OpenProject URL) and adds a `run` object to `results.json` so artifacts show which model produced the run.

**Squash TM (optional):** Create cases from [`mcp-eval/SQUASH_CASES.md`](mcp-eval/SQUASH_CASES.md) (title + prompt only; no manual steps), then fill numeric IDs in [`mcp-eval/squash-mapping.yaml`](mcp-eval/squash-mapping.yaml). Publish pass/fail results (no `test_steps`) with:

```bash
cd mcp-eval
export SQUASH_TM_API_TOKEN=...
export SQUASH_TM_ITERATION_ID=...
# optional: SQUASH_TM_SYNC_TEST_PLAN=true
python3 scripts/publish-mcp-eval-squash.py --json reports/results.json
# dry-run / missing auth: SQUASH_TM_DRY_RUN=true or SQUASH_TM_SKIP_MISSING_AUTH=true
```

CI (`mcp-eval.yml`) accepts optional `squash_iteration_id` / `squash_sync_test_plan` and writes `reports/squash-results.json` into the artifact. Unmapped local IDs are skipped with a warning until you fill `squash_test_case_id`.

**Curated `llm_model` choices** (workflow dropdown; no duplicate Llama entries):

| Choice | llm-stack | openrouter |
|--------|-----------|------------|
| `provider-default` | `Llama-3.3-70b-instruct` | `meta-llama/llama-3.3-70b-instruct` |
| `meta-llama/llama-3.3-70b-instruct` | remapped to `Llama-3.3-70b-instruct` | as-is |
| `openai/gpt-4o-mini` | rejected | as-is |
| `openai/gpt-4.1-mini` | rejected | as-is |
| `anthropic/claude-sonnet-4.5` | rejected | as-is |
| `google/gemini-2.5-flash` | rejected | as-is |

GitHub Actions cannot load OpenRouter’s full model catalog into the dropdown at dispatch time; this list is a static, tool-capable subset.
## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `E2E_ENV` | Target environment | `local` |
| `OPENPROJECT_HOST` | OpenProject hostname | per-env default |
| `NEXTCLOUD_HOST` | Nextcloud hostname | per-env default |
| `KEYCLOAK_HOST` | Keycloak hostname | per-env default |
| `E2E_OP_ADMIN_USER/PASS` | OpenProject admin credentials | `admin/admin` |
| `E2E_NC_ADMIN_USER/PASS` | Nextcloud admin credentials | `admin/admin` |
| `E2E_KC_ADMIN_USER/PASS` | Keycloak admin credentials | `admin/admin` |
| `E2E_ALICE_USER/PASS` | Realm user alice | `alice/1234` |
| `E2E_BRIAN_USER/PASS` | Realm user brian | `brian/1234` |
| `E2E_WORKERS` | Worker count | `1` |
| `MCP_OAUTH_TOKEN` | Playwright MCP Bearer token (must match `mcp.oauthToken`) | `bob_ai_mcp_test_token_1234567890` |
| `MCP_API_TOKEN` | Playwright MCP Bearer token (overrides `MCP_OAUTH_TOKEN`) | none |
| `MCP_BEARER_TOKEN` | mcp-eval Bearer token (same seeded token) | none (required for mcp-eval) |
| `LLM_PROVIDER` | `llm-stack` or `openrouter` | `llm-stack` |
| `LLM_API_KEY` | Generic OpenAI-compatible API key for mcp-eval | none |
| `LLM_BASE_URL` | OpenAI-compatible base URL override | provider default |
| `LLM_MODEL` | Model id (`provider-default`, OpenRouter-style id, or legacy `Llama-3.3-70b-instruct`) | provider default |
| `LLM_STACK_API_KEY` | llm-stack key (used when `LLM_PROVIDER=llm-stack`) | none |
| `LLM_STACK_URL` | llm-stack base URL | `https://llm-stack.openproject-edge.eu/v1` |
| `OPENROUTER_API_KEY` | OpenRouter key (used when `LLM_PROVIDER=openrouter`) | none |
| `SETUP_JOB_CHECK` | Wait for K8s setup-job | `false` |
| `SQUASH_TM_URL` | Squash TM base URL for result import | `https://squashtm.openproject.org/squash` |
| `SQUASH_TM_API_TOKEN` | Squash TM API token for result import | none |
| `SQUASH_TM_ITERATION_ID` | Target Squash TM iteration ID | none |
| `SQUASH_TM_SYNC_TEST_PLAN` | Add mapped test case IDs to the iteration before import | `false` |
| `SQUASH_TM_IMPORT_STEPS` | Import Playwright `test.step()` results as Squash `test_steps` | `false` |
| `SQUASH_TM_VALIDATE_STEP_COUNT` | Compare Playwright step count to Squash TM manual steps via API | `false` |
| `SQUASH_TM_STRICT_STEP_COUNT` | Fail publish on step count mismatch | `false` |
| `SQUASH_TM_DRY_RUN` | Write Squash payload without publishing | `false` |
| `SQUASH_TM_TEST_ATTACHMENT_EXTENSIONS` | Allowed per-test attachment extensions for Squash payloads | `txt,html,xml,doc,png,jpg,jpeg` (add `webm,zip` via env if needed) |

Put variables in `.env.local` for local runs. Place `opnc-root-ca.crt` in the project root for self-signed CA.
