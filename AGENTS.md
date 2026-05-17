# OpenProject Integration QA Agent Guide

This file is the canonical always-on project guidance for AI coding agents. Codex and Cursor read `AGENTS.md` directly. Claude Code reads `CLAUDE.md`, which imports this file. Keep this file tool-neutral and keep tool-specific adapters thin.

## Repository Shape

- This repository deploys and tests the OpenProject, Nextcloud, Keycloak, and XWiki integration stack through Helm, Helmfile, k3d, Docker, and Playwright.
- Helm/chart and environment work lives at the repository root, under `charts/`, `config/`, `environments/`, `scripts/`, and `helmfile.yaml`.
- End-to-end integration tests live under `e2e/`.
- Do not edit `charts/opnc-integration/values.yaml` for local configuration changes. Use `environments/override.yaml`, usually copied from `environments/override.yaml.example`.

## Commands

- Local stack setup: `make setup`, then `make deploy`.
- Development deployments: `make deploy-dev` or `make deploy-op-standalone`.
- Teardown: `make teardown`; delete the k3d cluster with `make teardown-all`.
- OpenProject RSpec inside the cluster: `make run-rspec-test SPEC=spec/path/to_spec.rb`.
- E2E tests from `e2e/`: `npm install`, `npm run playwright:install`, then `E2E_ENV=local npx playwright test`.
- Docker E2E run from `e2e/`: `./run-tests.sh`.

## E2E Conventions

- Before writing, modifying, or reviewing Playwright tests, page objects, locators, or E2E utilities, read `.agents/shared/openproject-e2e.md`.
- Test specs belong in `e2e/tests/`.
- Page object UI flows belong in `e2e/pageobjects/`.
- API helpers and orchestration belong in `e2e/utils/`.
- Selectors belong in `e2e/locators/*.json`; do not put raw selectors in specs.
- Use page object methods and `getLocator(...)` rather than inline Playwright selectors.
- Use the shared logger and typed catches from the E2E guide; do not add direct `console.*` logging in tests, page objects, or utilities.
- OpenProject file links and Nextcloud WebDAV files have separate cleanup paths; handle both when changing repeatable upload or file-link tests.

## Skills And Rules

- Canonical skill discovery for Codex and Cursor is `.agents/skills/`.
- Claude Code requires project skills under `.claude/skills/`; keep those files as tiny adapters that point back to `.agents/shared/`.
- Cursor already loads `.agents/skills/`, so do not duplicate skills under `.cursor/skills/`.
- Cursor path-scoped rules can stay under `.cursor/rules/` when glob activation is useful, but rule bodies should point to canonical files instead of copying their contents.
- If a skill or rule needs detailed reference material, put the source under `.agents/shared/` and point adapters to it.

## Editing Standards

- Keep changes scoped to the requested behavior and the existing repository patterns.
- Prefer structured parsers and existing helpers over ad hoc text manipulation.
- Keep documentation and comments concise; add comments only for non-obvious logic.
- Do not commit generated Playwright reports, traces, videos, local `.env` files, or local override files.
- Never revert unrelated local changes.
