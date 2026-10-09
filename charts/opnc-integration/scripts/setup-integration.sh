#!/bin/bash

set -eo pipefail

echo "###################################"
echo "# Setup integration app           #"
echo "###################################"

if [[ "$INTEGRATION_APP_SETUP_METHOD" != "oauth2" && "$INTEGRATION_APP_SETUP_METHOD" != "sso-nextcloud" && "$INTEGRATION_APP_SETUP_METHOD" != "sso-external" ]]; then
    echo "[ERROR] Invalid INTEGRATION_APP_SETUP_METHOD: $INTEGRATION_APP_SETUP_METHOD"
    echo "[ERROR] Valid options are: 'oauth2', 'sso-nextcloud', 'sso-external'"
    exit 1
fi

NEXTCLOUD_WAIT_URL="${NEXTCLOUD_WAIT_URL:-https://$NEXTCLOUD_HOST}"
OPENPROJECT_WAIT_URL="${OPENPROJECT_WAIT_URL:-https://$OPENPROJECT_HOST}"
KEYCLOAK_WAIT_URL="${KEYCLOAK_WAIT_URL:-https://$KEYCLOAK_HOST}"
NEXTCLOUD_WAIT_HOST_HEADER="${NEXTCLOUD_WAIT_HOST_HEADER:-}"
OPENPROJECT_WAIT_HOST_HEADER="${OPENPROJECT_WAIT_HOST_HEADER:-}"
KEYCLOAK_WAIT_HOST_HEADER="${KEYCLOAK_WAIT_HOST_HEADER:-}"

# export configs
export INTEGRATION_SETUP_DEBUG="${INTEGRATION_SETUP_DEBUG:-false}"
export SETUP_PROJECT_FOLDER='true'
export NC_HOST="https://$NEXTCLOUD_HOST"
export NC_ADMIN_USERNAME='admin'
export NC_ADMIN_PASSWORD='admin'
export NC_INTEGRATION_ENABLE_NAVIGATION='false'
export NC_INTEGRATION_ENABLE_SEARCH='false'
export OP_HOST="https://$OPENPROJECT_HOST"
export OP_ADMIN_USERNAME='admin'
export OP_ADMIN_PASSWORD='admin'
export OP_STORAGE_NAME='nextcloud'

# waits 5 minutes for the server to be ready
wait_for_server() {
    local url="$1"
    local host_header="${2:-}"
    local max_retry=60
    local retry=1

    while [[ $retry -le $max_retry ]]; do
        # --connect-timeout avoids hanging forever on ingress hairpin (k3d).
        curl_args=(-s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10)
        if [[ -n "$host_header" ]]; then
            curl_args+=(-H "Host: $host_header")
        fi
        server_status=$(curl "${curl_args[@]}" "$url" || echo "000")
        if [[ $server_status -ne 0 && $server_status -lt 400 ]]; then
            return 0
        fi
        echo "[INFO] Waiting for '$url' to be ready... (Retry $retry/$max_retry)"
        sleep 5
        ((retry++))
    done

    echo "[Timeout] Server is not ready: $url"
    return 1
}

download_integration_script() {
    local script_name="$1"
    local app_version
    local script_ref
    local script_url

    app_version=$(curl -fsS --connect-timeout 5 --max-time 15 \
        -u "$NC_ADMIN_USERNAME:$NC_ADMIN_PASSWORD" \
        -H 'OCS-APIRequest: true' \
        "$NC_HOST/ocs/v2.php/cloud/apps/integration_openproject?format=json" |
        jq -r '.ocs.data.version // empty')

    if [[ -n "${INTEGRATION_APP_GIT_BRANCH:-}" ]]; then
        script_ref="$INTEGRATION_APP_GIT_BRANCH"
    elif [[ "$app_version" =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
        script_ref="v${BASH_REMATCH[1]}"
    elif [[ -n "$app_version" ]]; then
        script_ref="master"
    else
        echo "[ERROR] Could not detect the installed integration_openproject version."
        return 1
    fi

    script_url="https://raw.githubusercontent.com/nextcloud/integration_openproject/${script_ref}/${script_name}"
    echo "[INFO] Downloading ${script_name} for integration_openproject ${app_version} (${script_ref})."
    curl -fsS --connect-timeout 5 --max-time 30 "$script_url" -o "$script_name"
}

# Tagged integration_oidc_setup.sh (≤3.1.1) still treats oauth2 client fields as the
# success signal. The app's OIDC /setup response is {"status":true} only, so those
# tags reject a successful setup. Master already checks status:true.
patch_integration_oidc_setup_script() {
    sed -i 's/sort -VC/sort -Vc/g' integration_oidc_setup.sh
    if grep -q 'nextcloud_oauth_client_name' integration_oidc_setup.sh; then
        sed -i \
            's|!= \*"nextcloud_oauth_client_name"\*|!= *'\''"status":true'\''*|' \
            integration_oidc_setup.sh
        sed -i \
            's/The response is missing nextcloud_oauth_client_name or openproject_redirect_uri/The response does not contain status:true./' \
            integration_oidc_setup.sh
        echo "[INFO] Patched integration_oidc_setup.sh OIDC success check to status:true."
    fi
}

# Exit code for deterministic, non-retryable failures; matched by the Job's
# podFailurePolicy so Kubernetes fails the whole job instead of retrying.
TERMINAL_EXIT_CODE=42
INTEGRATION_SETUP_LOG='/tmp/integration-setup.log'

_handle_integration_script_failure() {
    echo "" >&2
    echo "[ERROR] Integration setup script exited with an error (see above)." >&2
    if grep -q 'Authentication Method requires at least the Corporate enterprise plan' "$INTEGRATION_SETUP_LOG" 2>/dev/null; then
        echo "[ERROR] Setup method '${INTEGRATION_APP_SETUP_METHOD}' requires a Corporate-tier OpenProject enterprise plan." >&2
        echo "[ERROR] Verify that OPENPROJECT_SEED__ENTERPRISE__TOKEN in the deployment values is a valid Corporate plan token." >&2
        echo "[ERROR] This error cannot be fixed by retrying; failing the setup job." >&2
        exit "$TERMINAL_EXIT_CODE"
    fi
    if grep -q 'The user "OpenProject" already exists' "$INTEGRATION_SETUP_LOG" 2>/dev/null; then
        echo "[ERROR] Nextcloud contains stale partial integration setup state; retrying the same job cannot repair it." >&2
        exit "$TERMINAL_EXIT_CODE"
    fi
    exit 1
}

# wait for servers
echo "[INFO] Waiting for Nextcloud to be ready..."
wait_for_server "$NEXTCLOUD_WAIT_URL" "$NEXTCLOUD_WAIT_HOST_HEADER"
echo "[INFO] Nextcloud is ready."
echo "[INFO] Waiting for OpenProject to be ready..."
wait_for_server "$OPENPROJECT_WAIT_URL" "$OPENPROJECT_WAIT_HOST_HEADER"
echo "[INFO] OpenProject is ready."

# Optional public-endpoint checks (PullPreview ACME). Disabled by default when
# in-cluster waits are used — k3d host-alias hairpin can burn the job deadline.
if [[ "${CHECK_EXTERNAL_ENDPOINTS:-false}" == "true" && "$NC_HOST" != "$NEXTCLOUD_WAIT_URL" ]]; then
    echo "[INFO] Waiting for Nextcloud external endpoint ($NC_HOST) to be ready..."
    wait_for_server "$NC_HOST"
fi
if [[ "${CHECK_EXTERNAL_ENDPOINTS:-false}" == "true" && "$OP_HOST" != "$OPENPROJECT_WAIT_URL" ]]; then
    echo "[INFO] Waiting for OpenProject external endpoint ($OP_HOST) to be ready..."
    wait_for_server "$OP_HOST"
fi

if [[ "$INTEGRATION_APP_SETUP_METHOD" == "oauth2" ]]; then
    download_integration_script integration_setup.sh

    OPENPROJECT_HOST="https://$OPENPROJECT_HOST" \
    NEXTCLOUD_HOST="https://$NEXTCLOUD_HOST" \
    OPENPROJECT_STORAGE_NAME='nextcloud' \
    bash integration_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure

elif [[ "$INTEGRATION_APP_SETUP_METHOD" == "sso-nextcloud" ]]; then
    download_integration_script integration_oidc_setup.sh
    patch_integration_oidc_setup_script

    NC_INTEGRATION_PROVIDER_TYPE=nextcloud_hub \
    NC_INTEGRATION_OP_CLIENT_ID=$OIDC_OPENPROJECT_CLIENT_ID \
    NC_INTEGRATION_OP_CLIENT_SECRET=$OIDC_OPENPROJECT_CLIENT_SECRET \
    OP_USE_LOGIN_TOKEN=true \
    bash integration_oidc_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure

elif [[ "$INTEGRATION_APP_SETUP_METHOD" == "sso-external" ]]; then
    echo "[INFO] Waiting for Keycloak to be ready..."
    wait_for_server "$KEYCLOAK_WAIT_URL" "$KEYCLOAK_WAIT_HOST_HEADER"
    echo "[INFO] Keycloak is ready."

    download_integration_script integration_oidc_setup.sh
    patch_integration_oidc_setup_script

    NC_INTEGRATION_PROVIDER_TYPE=external \
    NC_INTEGRATION_PROVIDER_NAME=$OIDC_KEYCLOAK_PROVIDER_NAME \
    NC_INTEGRATION_OP_CLIENT_ID=$OIDC_OPENPROJECT_CLIENT_ID \
    NC_INTEGRATION_TOKEN_EXCHANGE=true \
    OP_STORAGE_AUDIENCE=nextcloud \
    OP_STORAGE_SCOPE=add-nc-aud \
    bash integration_oidc_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure
fi
