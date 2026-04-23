# Test automation (Playwright E2E)

This repository contains the deployment stack (Helm/helmfile) **and** the Playwright end-to-end tests under [`e2e/`](e2e/) (subtree-merged from `opf/openproject-e2e`).

## Local runs

1. Bring up the stack (k3d):

```bash
make setup
make deploy
```

2. Run E2E tests:

- Docker runner (recommended, no local browsers):

```bash
./e2e/run-tests.sh
```

- Native runner:

```bash
cd e2e
npm ci
npx playwright install --with-deps chromium
E2E_ENV=local npx playwright test
```

## CI runs

Use the manual workflow in `.github/workflows/e2e.yml` (deploys PullPreview, validates endpoints, runs Playwright, then tears down unless you opt to keep it on failure).

## Documentation

- E2E specifics: [`e2e/README.md`](e2e/README.md)
- Test conventions (locators/page objects/logging): [`.cursor/skills/tests/SKILL.md`](.cursor/skills/tests/SKILL.md)
- Interactive debugging with `playwright-cli`: [`.claude/skills/playwright-cli/SKILL.md`](.claude/skills/playwright-cli/SKILL.md)

