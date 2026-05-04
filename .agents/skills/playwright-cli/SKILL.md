---
name: playwright-cli
description: Interactive browser automation via playwright-cli (snapshots, tracing, exploration). For this repository, committed Playwright tests follow .agents/shared/openproject-e2e.md; use this skill for CLI sessions and mapping selectors into locators, not for pasting raw page.* calls into specs.
allowed-tools: Bash(playwright-cli:*)
---

# Browser Automation with playwright-cli

Canonical source: `.agents/shared/playwright-cli/SKILL.md`.

When this skill triggers, read `.agents/shared/playwright-cli/SKILL.md` before using `playwright-cli`. This adapter stays at `.agents/skills/playwright-cli/SKILL.md` so Codex can auto-discover it.

Repository rule: `playwright-cli` is for interactive exploration only. Committed Playwright tests must follow `.agents/shared/openproject-e2e.md`; CLI-generated code is selector/page-object input, not copy-paste spec code.

Canonical references live under `.agents/shared/playwright-cli/references/`.
