---
name: tests
description: E2E test conventions for OpenProject integration tests. Use when writing, modifying, or reviewing Playwright tests, page objects, utilities, or locators in this repository.
---

# OpenProject E2E Tests Skill

Canonical source: `.agents/shared/openproject-e2e.md`.

When this skill triggers, read `.agents/shared/openproject-e2e.md` before writing or reviewing E2E tests. This adapter stays at `.agents/skills/tests/SKILL.md` so Codex can auto-discover it.

Bootstrap rules:

- The Playwright project lives under `e2e/`.
- Keep selectors in `locators/*.json`, not in spec files.
- Put UI flows in page objects and API/data orchestration in `utils/`.
- Use `logDebug` / `logInfo` / `logWarn` / `logError`, typed catches, and `getErrorMessage`.
- For OpenProject/Nextcloud integration details, especially SSO user provisioning and file-link cleanup, follow the canonical guide.
