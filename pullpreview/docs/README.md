# PullPreview

Deploy the integration stack on Hetzner via [PullPreview](https://github.com/pullpreview/pullpreview) for PR previews and manual E2E runs.

PullPreview does not require a local k3d stack. For local development and testing on `*.test` hosts, see [Deploy Setup Locally (k3d)](../../README.md#deploy-setup-locally-k3d) in the root README.

## Phase 1 smoke deployment

Use the PullPreview CLI against the OpenProject chart and [`../openproject-smoke-values.yaml`](../openproject-smoke-values.yaml):

```bash
PULLPREVIEW_PROVIDER=hetzner \
PULLPREVIEW_MAX_DOMAIN_LENGTH=40 \
HCLOUD_TOKEN=... \
HETZNER_CA_KEY=... \
pullpreview up "$(pwd)" \
  --name opf-op-smoke \
  --deployment-target helm \
  --chart ./charts/openproject \
  --chart-values pullpreview/openproject-smoke-values.yaml \
  --chart-set openproject.host={{ pullpreview_public_dns }} \
  --proxy-tls openproject:8080 \
  --region fsn1 \
  --image ubuntu-24.04 \
  --instance-type cpx42 \
  --dns my.opf.run
```

Run from the repository root.

Destroy the smoke deployment with:

```bash
PULLPREVIEW_PROVIDER=hetzner pullpreview down --name opf-op-smoke
```

## Phase 2 stack deployment

PullPreview still uses [`charts/pullpreview-stack`](../../charts/pullpreview-stack) as the chart path for `pullpreview/action`, but **CI deploys the stack in phases with helmfile** (aligned with local releases, not identical order), not as one long umbrella `helm install --wait`.

| | Local (`make deploy`) | PullPreview / E2E CI |
|---|---|---|
| Orchestration | [`helmfile.yaml.gotmpl`](../../helmfile.yaml.gotmpl) — cert-manager → opnc-integration (incl. `setup-job`) → openproject → nextcloud / keycloak / xwiki | [`helmfile.yaml.gotmpl`](../helmfile.yaml.gotmpl) — traefik → opnc-integration (bootstrap only) → openproject → keycloak → nextcloud → **opnc-setup-job** → xwiki |
| Namespace | `opnc-integration` (k3d) | Dynamic `pp-gh-…` (PullPreview) |
| Hosts | `/etc/hosts` (`*.test`) | `*.my.opf.run` (generated FQDN) |
| Integration wiring | Wait for `setup-job` **Completed** (root README) | `opnc-setup-job` release after OpenProject/Keycloak/Nextcloud, then [`wait-setup-job.sh`](../wait-setup-job.sh) |
| GitHub summary | — | Per-service URL checks and deploy status ([`e2e.yml`](../../.github/workflows/e2e.yml), [`pullpreview.yml`](../../.github/workflows/pullpreview.yml)) |

Phased sync runs on the preview VM via [`helmfile-sync.sh`](../helmfile-sync.sh) (triggered from [`pre-script-helm-deps.sh`](../pre-script-helm-deps.sh) when the action installs `pullpreview-stack`). Values come from [`environments/pullpreview/config.yaml.gotmpl`](../../environments/pullpreview/config.yaml.gotmpl) and the same [`values/*.gotmpl`](../../values/) templates as local, with `previewMode: true` (no in-cluster CA / cert-manager path).

Before pushing PullPreview changes, run from the repository root:

```bash
make validate-pullpreview-helmfile
```

That runs [`validate-helmfile.sh`](../validate-helmfile.sh) (helmfile build + template for opnc-integration, openproject, keycloak, nextcloud, and opnc-setup-job).

## CI workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| [`.github/workflows/pullpreview.yml`](../../.github/workflows/pullpreview.yml) | PR label `pullpreview`, schedule | Full stack on PR previews |
| [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) | Manual `workflow_dispatch` | Deploy + Playwright (optional setup-only) |
| [`.github/workflows/pullpreview-cleanup.yml`](../../.github/workflows/pullpreview-cleanup.yml) | Manual `workflow_dispatch` | List or tear down previews (`target`: `e2e`, `setup`, `pr`, `all`; `mode`: list / teardown; set `confirm_teardown` for teardown) |

Use **PullPreview Cleanup** when a preview was kept after a failed E2E run (`target=e2e`) or a setup-only deploy (`target=setup`), or to remove PR previews (`target=pr`).

Repository secrets: `HCLOUD_TOKEN`, `HETZNER_CA_KEY`, and (full stack) `OPENPROJECT_ENTERPRISE_TOKEN`. PR previews need the `pullpreview` label.

Published URLs follow the generated FQDN, for example `https://<fqdn>`, `https://nextcloud.<fqdn>`, and `https://keycloak.<fqdn>/realms/opnc`.

## Layout

| Path | Role |
|---|---|
| [`helmfile.yaml.gotmpl`](../helmfile.yaml.gotmpl) | Phased PullPreview releases |
| [`stack-values.yaml.gotmpl`](../stack-values.yaml.gotmpl) | Values passed to `pullpreview/action` (DNS, versions) |
| [`pre-script-helm-deps.sh`](../pre-script-helm-deps.sh) | Helm/helmfile bootstrap on the preview VM |
| [`helmfile-sync.sh`](../helmfile-sync.sh) | Sequential release sync |
| [`environments/pullpreview/`](../../environments/pullpreview/) | PullPreview-specific helmfile environment |

E2E tests against a live preview: [`e2e/README.md`](../../e2e/README.md).
