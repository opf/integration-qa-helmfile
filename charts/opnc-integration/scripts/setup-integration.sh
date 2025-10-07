#!/bin/bash

set -eo pipefail

echo "###################################"
echo "# Setup integration app           #"
echo "###################################"

has_integration_setup() {
    local response
    local setup_without_project_folder
    local setup_with_project_folder

    response=$(curl -s -XGET -uadmin:admin \
        "https://$NEXTCLOUD_HOST/index.php/apps/integration_openproject/check-admin-config" \
        -H 'Content-Type: application/json')
    setup_without_project_folder=$(echo "$response" | jq -r ".config_status_without_project_folder")
    setup_with_project_folder=$(echo "$response" | jq -r ".project_folder_setup_status")

    if [[ "$setup_without_project_folder" == "true" || "$setup_with_project_folder" == "true" ]]; then
        return 0
    else
        return 1
    fi
}

# waits 5 minutes for the server to be ready
wait_for_server() {
    local url="$1"
    local max_retry=60
    local retry=1

    while [[ $retry -le $max_retry ]]; do
        server_status=$(curl -s -o /dev/null -w "%{http_code}" "$url" || echo "000")
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

if has_integration_setup; then
    echo "[INFO] Integration app is already set up. Skipping integration setup."
    exit 0
fi

if [[ "$INTEGRATION_APP_SETUP_METHOD" != "oauth2" && "$INTEGRATION_APP_SETUP_METHOD" != "sso-nextcloud" && "$INTEGRATION_APP_SETUP_METHOD" != "sso-external" ]]; then
    echo "[ERROR] Invalid INTEGRATION_APP_SETUP_METHOD: $INTEGRATION_APP_SETUP_METHOD"
    echo "[ERROR] Valid options are: 'oauth2', 'sso-nextcloud', 'sso-external'"
    exit 1
fi

# wait for servers
echo "[INFO] Waiting for Nextcloud to be ready..."
wait_for_server "https://$NEXTCLOUD_HOST"
echo "[INFO] Nextcloud is ready."
echo "[INFO] Waiting for OpenProject to be ready..."
wait_for_server "https://$OPENPROJECT_HOST"
echo "[INFO] OpenProject is ready."

SCRIPT_URL="https://raw.githubusercontent.com/nextcloud/integration_openproject/master"

if [[ "$INTEGRATION_APP_SETUP_METHOD" == "oauth2" ]]; then
    status=$(curl -s -w "%{http_code}" $SCRIPT_URL/integration_setup.sh -o integration_setup.sh)
    if [[ $status -ne 200 ]]; then
        echo "[ERROR] Failed to download script: $SCRIPT_URL/integration_setup.sh"
        exit 1
    fi

    INTEGRATION_SETUP_DEBUG=true \
        SETUP_PROJECT_FOLDER=true \
        NEXTCLOUD_HOST=https://$NEXTCLOUD_HOST \
        NC_ADMIN_USERNAME=admin \
        NC_ADMIN_PASSWORD=admin \
        OPENPROJECT_HOST=https://$OPENPROJECT_HOST \
        OP_ADMIN_USERNAME='admin' \
        OP_ADMIN_PASSWORD='admin' \
        OPENPROJECT_STORAGE_NAME='nextcloud' \
        bash integration_setup.sh

elif [[ "$INTEGRATION_APP_SETUP_METHOD" == "sso-nextcloud" ]]; then
    status=$(curl -s -w "%{http_code}" $SCRIPT_URL/integration_oidc_setup.sh -o integration_oidc_setup.sh)
    if [[ $status -ne 200 ]]; then
        echo "[ERROR] Failed to download script: $SCRIPT_URL/integration_oidc_setup.sh"
        exit 1
    fi
    # patch for sort command compatibility
    sed -i 's/sort -VC/sort -Vc/g' integration_oidc_setup.sh

    INTEGRATION_SETUP_DEBUG=true \
        SETUP_PROJECT_FOLDER=true \
        NC_INTEGRATION_PROVIDER_TYPE=nextcloud_hub \
        NC_ADMIN_USERNAME=admin \
        NC_ADMIN_PASSWORD=admin \
        NC_INTEGRATION_OP_CLIENT_ID=$OIDC_OPENPROJECT_CLIENT_ID \
        NC_INTEGRATION_OP_CLIENT_SECRET=$OIDC_OPENPROJECT_CLIENT_SECRET \
        NC_INTEGRATION_ENABLE_NAVIGATION=false \
        NC_INTEGRATION_ENABLE_SEARCH=false \
        NC_HOST=https://$NEXTCLOUD_HOST \
        OP_ADMIN_USERNAME=admin \
        OP_ADMIN_PASSWORD=admin \
        OP_STORAGE_NAME=nextcloud \
        OP_HOST=https://$OPENPROJECT_HOST \
        OP_USE_LOGIN_TOKEN=true \
        bash integration_oidc_setup.sh

elif [[ "$INTEGRATION_APP_SETUP_METHOD" == "sso-external" ]]; then
    echo "[INFO] Waiting for Keycloak to be ready..."
    wait_for_server "https://$KEYCLOAK_HOST"
    echo "[INFO] Keycloak is ready."

    curl -s $SCRIPT_URL/integration_oidc_setup.sh -o integration_oidc_setup.sh
    status=$(curl -s -w "%{http_code}" $SCRIPT_URL/integration_oidc_setup.sh -o integration_oidc_setup.sh)
    if [[ $status -ne 200 ]]; then
        echo "[ERROR] Failed to download script: $SCRIPT_URL/integration_oidc_setup.sh"
        exit 1
    fi
    # patch for sort command compatibility
    sed -i 's/sort -VC/sort -Vc/g' integration_oidc_setup.sh

    INTEGRATION_SETUP_DEBUG=true \
        SETUP_PROJECT_FOLDER=true \
        NC_HOST=https://$NEXTCLOUD_HOST \
        NC_ADMIN_USERNAME=admin \
        NC_ADMIN_PASSWORD=admin \
        NC_INTEGRATION_PROVIDER_TYPE=external \
        NC_INTEGRATION_PROVIDER_NAME=$OIDC_KEYCLOAK_PROVIDER_NAME \
        NC_INTEGRATION_OP_CLIENT_ID=$OIDC_OPENPROJECT_CLIENT_ID \
        NC_INTEGRATION_TOKEN_EXCHANGE=true \
        NC_INTEGRATION_ENABLE_NAVIGATION=false \
        NC_INTEGRATION_ENABLE_SEARCH=false \
        OP_HOST=https://$OPENPROJECT_HOST \
        OP_ADMIN_USERNAME=admin \
        OP_ADMIN_PASSWORD=admin \
        OP_STORAGE_NAME=nextcloud \
        OP_STORAGE_AUDIENCE=nextcloud \
        OP_STORAGE_SCOPE=add-nc-aud \
        bash integration_oidc_setup.sh
fi
