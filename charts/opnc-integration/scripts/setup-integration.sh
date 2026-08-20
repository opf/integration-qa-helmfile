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
NEXTCLOUD_INTEGRATION_CHECK_URL="${NEXTCLOUD_INTEGRATION_CHECK_URL:-${NEXTCLOUD_WAIT_URL%/status.php}/index.php/apps/integration_openproject/check-admin-config}"
NEXTCLOUD_INTEGRATION_CHECK_HOST_HEADER="${NEXTCLOUD_INTEGRATION_CHECK_HOST_HEADER:-$NEXTCLOUD_WAIT_HOST_HEADER}"

# export configs
export INTEGRATION_SETUP_DEBUG='true'
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

has_integration_setup() {
    local response
    local curl_args=(-s -u"${NC_ADMIN_USERNAME}:${NC_ADMIN_PASSWORD}")

    if [[ -n "$NEXTCLOUD_INTEGRATION_CHECK_HOST_HEADER" ]]; then
        curl_args+=(-H "Host: $NEXTCLOUD_INTEGRATION_CHECK_HOST_HEADER")
    fi
    if ! response=$(curl "${curl_args[@]}" "$NEXTCLOUD_INTEGRATION_CHECK_URL"); then
        return 1
    fi

    local base_status="" folder_status=""
    base_status=$(echo "$response" | jq -r '.config_status_without_project_folder' 2>/dev/null || true)
    if [[ "$base_status" != "true" ]]; then
        return 1
    fi

    if [[ "${SETUP_PROJECT_FOLDER}" == "true" ]]; then
        folder_status=$(echo "$response" | jq -r '.project_folder_setup_status' 2>/dev/null || true)
        if [[ "$folder_status" != "true" ]]; then
            return 1
        fi
    fi

    return 0
}

# waits 5 minutes for the server to be ready
wait_for_server() {
    local url="$1"
    local host_header="${2:-}"
    local max_retry=60
    local retry=1

    while [[ $retry -le $max_retry ]]; do
        curl_args=(-s -o /dev/null -w "%{http_code}")
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
    exit 1
}

# wait for servers
echo "[INFO] Waiting for Nextcloud to be ready..."
wait_for_server "$NEXTCLOUD_WAIT_URL" "$NEXTCLOUD_WAIT_HOST_HEADER"
echo "[INFO] Nextcloud is ready."
echo "[INFO] Waiting for OpenProject to be ready..."
wait_for_server "$OPENPROJECT_WAIT_URL" "$OPENPROJECT_WAIT_HOST_HEADER"
echo "[INFO] OpenProject is ready."

if has_integration_setup; then
    echo "[INFO] Integration app is already set up. Skipping integration setup."
    exit 0
fi

SCRIPT_URL="https://raw.githubusercontent.com/nextcloud/integration_openproject/master"

if [[ "$NC_HOST" != "$NEXTCLOUD_WAIT_URL" ]]; then
    echo "[INFO] Waiting for Nextcloud external endpoint ($NC_HOST) to be ready..."
    wait_for_server "$NC_HOST"
fi
if [[ "$OP_HOST" != "$OPENPROJECT_WAIT_URL" ]]; then
    echo "[INFO] Waiting for OpenProject external endpoint ($OP_HOST) to be ready..."
    wait_for_server "$OP_HOST"
fi

if [[ "$INTEGRATION_APP_SETUP_METHOD" == "oauth2" ]]; then
    status=$(curl -s -w "%{http_code}" $SCRIPT_URL/integration_setup.sh -o integration_setup.sh)
    if [[ $status -ne 200 ]]; then
        echo "[ERROR] Failed to download script: $SCRIPT_URL/integration_setup.sh"
        exit 1
    fi

    OPENPROJECT_HOST="https://$OPENPROJECT_HOST" \
    NEXTCLOUD_HOST="https://$NEXTCLOUD_HOST" \
    OPENPROJECT_STORAGE_NAME='nextcloud' \
    bash integration_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure

elif [[ "$INTEGRATION_APP_SETUP_METHOD" == "sso-nextcloud" ]]; then
    status=$(curl -s -w "%{http_code}" $SCRIPT_URL/integration_oidc_setup.sh -o integration_oidc_setup.sh)
    if [[ $status -ne 200 ]]; then
        echo "[ERROR] Failed to download script: $SCRIPT_URL/integration_oidc_setup.sh"
        exit 1
    fi
    # patch for sort command compatibility
    sed -i 's/sort -VC/sort -Vc/g' integration_oidc_setup.sh

    NC_INTEGRATION_PROVIDER_TYPE=nextcloud_hub \
    NC_INTEGRATION_OP_CLIENT_ID=$OIDC_OPENPROJECT_CLIENT_ID \
    NC_INTEGRATION_OP_CLIENT_SECRET=$OIDC_OPENPROJECT_CLIENT_SECRET \
    OP_USE_LOGIN_TOKEN=true \
    bash integration_oidc_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure

elif [[ "$INTEGRATION_APP_SETUP_METHOD" == "sso-external" ]]; then
    echo "[INFO] Waiting for Keycloak to be ready..."
    wait_for_server "$KEYCLOAK_WAIT_URL" "$KEYCLOAK_WAIT_HOST_HEADER"
    echo "[INFO] Keycloak is ready."

    status=$(curl -s -w "%{http_code}" $SCRIPT_URL/integration_oidc_setup.sh -o integration_oidc_setup.sh)
    if [[ $status -ne 200 ]]; then
        echo "[ERROR] Failed to download script: $SCRIPT_URL/integration_oidc_setup.sh"
        exit 1
    fi
    # patch for sort command compatibility
    sed -i 's/sort -VC/sort -Vc/g' integration_oidc_setup.sh

    NC_INTEGRATION_PROVIDER_TYPE=external \
    NC_INTEGRATION_PROVIDER_NAME=$OIDC_KEYCLOAK_PROVIDER_NAME \
    NC_INTEGRATION_OP_CLIENT_ID=$OIDC_OPENPROJECT_CLIENT_ID \
    NC_INTEGRATION_TOKEN_EXCHANGE=true \
    OP_STORAGE_AUDIENCE=nextcloud \
    OP_STORAGE_SCOPE=add-nc-aud \
    bash integration_oidc_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure
fi
