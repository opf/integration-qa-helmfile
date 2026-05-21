---
name: tests
description: E2E test conventions for OpenProject integration tests. Use when writing, modifying, or reviewing Playwright tests, page objects, utilities, or locators in this repository.
paths:
  - "e2e/tests/**/*.ts"
  - "e2e/pageobjects/**/*.ts"
  - "e2e/utils/**/*.ts"
  - "e2e/locators/**/*.json"
  - "e2e/playwright.config.ts"
  - "e2e/global-setup.ts"
---

# OpenProject E2E Tests Skill

Canonical source: `.agents/shared/openproject-e2e.md`.

When this skill triggers, read `.agents/shared/openproject-e2e.md` before writing or reviewing E2E tests. This adapter stays at `.agents/skills/tests/SKILL.md` so Codex and Cursor can auto-discover it.

Bootstrap rules:

- The Playwright project lives under `e2e/`.
- Keep selectors in `locators/*.json`, not in spec files.
- Put UI flows in page objects and API/data orchestration in `utils/`.
- For Squash TM-mapped tests, use `squashTestCase(...)` from `utils/squash-metadata.ts`; follow the canonical guide for reference format and numeric Squash IDs.
- Use `logDebug` / `logInfo` / `logWarn` / `logError`, typed catches, and `getErrorMessage`.
- For OpenProject/Nextcloud integration details, especially SSO user provisioning and file-link cleanup, follow the canonical guide.
