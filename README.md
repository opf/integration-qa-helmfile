# Openproject-Nextcloud Integration Helm Chart

- [Dependencies](#dependencies)
- [Deploy Setup Locally (k3d)](#deploy-setup-locally-k3d)
- [Configuring the Deployment](#configuring-the-deployment)
- [PullPreview](#pullpreview)
- [Serve From Git Branch](#serve-from-git-branch)
- [Serve OpenProject From Local Branch](#serve-openproject-from-local-branch)
- [Serve Standalone OpenProject (Local Branch)](#serve-standalone-openproject-local-branch)
- [Trust Self-Signed Certificates](#trust-self-signed-certificates)

## Dependencies

- [k3d](https://k3d.io/stable/#install-script)
- [docker](https://docs.docker.com/engine/install/)
- [helm](https://helm.sh/docs/intro/install/#through-package-managers)
- [helm-diff](https://github.com/databus23/helm-diff?tab=readme-ov-file#using-helm-plugin-manager--23x) plugin
- [helmfile](https://helmfile.readthedocs.io/en/latest/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/#kubectl)
- [make](https://sp21.datastructur.es/materials/guides/make-install.html)

## Deploy Setup Locally (k3d)

1. Setup Kubernetes cluster and necessary resources:

   ```bash
   make setup
   ```

2. Deploy the integration chart:

   ```bash
   make deploy
   ```

3. Check the pods:

   ```bash
   kubectl get pods -n opnc-integration
   ```

4. Add these hosts to your `/etc/hosts` file:
   ```bash
    sudo echo "127.0.0.1	openproject.test nextcloud.test keycloak.test openproject-assets.test" | sudo tee -a /etc/hosts
   ```

NOTE: make sure at least one `setup-job-*` pod is completed successfully before proceeding.

```bash
NAME                                          READY   STATUS      RESTARTS   AGE
setup-job-5nwlm                               0/1     Error       0          17m
setup-job-mkgrf                               0/1     Completed   0          12m
```

Access the services via the following URLs:

- OpenProject: [https://openproject.test](https://openproject.test)
- Nextcloud: [https://nextcloud.test](https://nextcloud.test)
- Keycloak: [https://keycloak.test](https://keycloak.test)

To uninstall the deployment, run:

```bash
make teardown
```

or if you want to delete the K8s cluster as well, run:

```bash
make teardown-all
```

## Configuring the Deployment

⚠️ Do not edit `charts/opnc-integration/values.yaml` directly.
All configuration must go into [environments/default/config.yaml](https://github.com/saw-jan/opnc-helm-chart/blob/master/environments/default/config.yaml).
This file overrides the chart defaults and is the source of truth for deployments.

### Example: Changing app version

To change the version of the `integration_openproject` app in Nextcloud:

```yaml
# environments/default/config.yaml
nextcloud:
  extraApps:
    - name: integration_openproject
      version: '2.8.1'
```

## PullPreview

### Phase 1 smoke deployment

Use the installed PullPreview CLI against the existing OpenProject chart and [`pullpreview/openproject-smoke-values.yaml`](/Users/crohr/dev/opf/integration-qa-helmfile/pullpreview/openproject-smoke-values.yaml):

```bash
PULLPREVIEW_PROVIDER=hetzner \
PULLPREVIEW_MAX_DOMAIN_LENGTH=40 \
HCLOUD_TOKEN=... \
HETZNER_CA_KEY=... \
pullpreview up /Users/crohr/dev/opf/integration-qa-helmfile \
  --name opf-op-smoke \
  --deployment-target helm \
  --chart ./charts/openproject \
  --chart-values pullpreview/openproject-smoke-values.yaml \
  --chart-set openproject.host={{ pullpreview_public_dns }} \
  --proxy-tls openproject:8080 \
  --region fsn1 \
  --image ubuntu-24.04 \
  --instance-type cpx42 \
  --dns my.preview.run
```

Destroy the smoke deployment with:

```bash
PULLPREVIEW_PROVIDER=hetzner pullpreview down --name opf-op-smoke
```

### Phase 2 stack deployment

[`charts/pullpreview-stack`](/Users/crohr/dev/opf/integration-qa-helmfile/charts/pullpreview-stack) packages the full OpenProject, Nextcloud, Keycloak, and integration setup as a single Helm release for PullPreview. It runs the integration chart in `previewMode`, which keeps the existing local k3d workflow unchanged while disabling the self-signed internal TLS path used by the README flow.

The GitHub workflow is in [`pullpreview.yml`](/Users/crohr/dev/opf/integration-qa-helmfile/.github/workflows/pullpreview.yml) and expects repository secrets `HCLOUD_TOKEN` and `HETZNER_CA_KEY`, plus the trigger label `pullpreview`.
It publishes the main OpenProject preview on the generated FQDN and exposes the related services on subdomains of that same host, for example `https://<fqdn>`, `https://nextcloud.<fqdn>`, and `https://keycloak.<fqdn>/realms/opnc`.

## Serve From Git Branch

You can serve the OpenProject and Nextcloud servers using a specific git branch. Set the following config in the [config.yaml](./environments/default/config.yaml) file:

```yaml
openproject:
  gitSourceBranch: '<git-branch-name>'

nextcloud:
  gitSourceBranch: '<git-branch-name>'
```

Similarly, you can enable Nextcloud apps using a specific git branch:

```yaml
nextcloud:
  enableApps:
    - name: 'app_name'
      gitBranch: '<app-git-branch>'
```

_**NOTE**: This can take a long time to build the source code and deploy the application._

## Serve OpenProject From Local Branch

You can serve the OpenProject using the local source path. Run the following command:

1. Teardown existing deployment (if any):

   ```bash
   make teardown-all
   ```

2. Setup the cluster again with local source path:

   ```bash
   OP_LOCAL_REPO_DIR=<path-to-local-openproject-repo> make setup
   ```

3. Deploy the dev setup:

   ```bash
   make deploy-dev
   ```

_**NOTE**: This can take a long time to build the source code and deploy the application._

## Serve Standalone OpenProject (Local Branch)

You can serve the OpenProject in standalone mode for the development setup. This doesn't run Nextcloud and Keycloak. Run the following command:

1. Teardown existing deployment (if any):

   ```bash
   make teardown-all
   ```

2. Setup the cluster again with local source path:

   ```bash
   OP_LOCAL_REPO_DIR=<path-to-local-openproject-repo> make setup
   ```

3. Deploy the dev setup:

   ```bash
   make dev-op-standalone
   ```

## Trust Self-Signed Certificates

If you are using self-signed certificates, you may need to trust them in your browser. Follow these steps:

1. Get the certificate from the cluster:

   ```bash
   kubectl get secret opnc-ca-secret -n opnc-integration -o jsonpath='{.data.ca\.crt}' | base64 -d > opnc-root-ca.crt
   ```

2. Import the certificate:

   **a. Linux**

   ```bash
   sudo cp opnc-root-ca.crt /usr/local/share/ca-certificates/
   sudo update-ca-certificates
   ```

   Import the certificate into the certificates store (for browsers):

   ```bash
   certutil -A -n "NC-OP Integration Root CA" -t TC -d sql:"$HOME/.pki/nssdb" -i opnc-root-ca.crt
   ```

   **b. macOS**

   ```bash
   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain opnc-root-ca.crt
   ```
