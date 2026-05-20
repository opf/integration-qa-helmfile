#!/bin/bash

set -e

BASE_URL="http://localhost:8080"
DIST_URL="$BASE_URL/bin/distribution/XWiki/Distribution"
EXT_URL="$BASE_URL/bin/get/XWiki/Extensions"
WEBAPPS_DIR=/usr/local/tomcat/webapps/ROOT/WEB-INF
XWIKI_VERSION=$(sed -n 's/^version=//p' $WEBAPPS_DIR/version.properties)
EXTENSION_REPO="/usr/local/xwiki/data/extension/repository"
FLAVOR_NAME="xwiki-platform-distribution-flavor-xip"
XWIKI_DOWNLOAD_URL="https://nexus.xwiki.org/nexus/content/repositories/releases/org/xwiki"

if [ -z "$OPENPROJECT_HOST" ]; then
    echo "[ERROR] OPENPROJECT_HOST is not set."
    exit 1
fi

if [ -z "$OPENPROJECT_CLIENT_ID" ] || [ -z "$OPENPROJECT_CLIENT_SECRET" ]; then
    echo "[ERROR] OPENPROJECT_CLIENT_ID and OPENPROJECT_CLIENT_SECRET are not set."
    exit 1
fi

echo "############################################"
echo "# Download XWiki Standard Flavor           #"
echo "############################################"
curl -sSL "$XWIKI_DOWNLOAD_URL/platform/$FLAVOR_NAME/$XWIKI_VERSION/$FLAVOR_NAME-$XWIKI_VERSION.xip" \
    -o $FLAVOR_NAME.xip
mkdir -p "$EXTENSION_REPO"
unzip -n -q "$FLAVOR_NAME.xip" -d "$EXTENSION_REPO"
rm "$FLAVOR_NAME.xip"
echo "[INFO] Standard flavor downloaded to $EXTENSION_REPO"

echo "############################################"
echo "# Start XWiki                              #"
echo "############################################"
/entrypoint/start.sh &

echo "[INFO] Waiting for XWiki to start..."
until curl -sL "$DIST_URL" > /dev/null; do
    sleep 5
done

ADMIN_PASS=$(sed -n 's/^xwiki.superadminpassword=//p' $WEBAPPS_DIR/xwiki.cfg)
SUPER_ADMIN_AUTH="superadmin:$ADMIN_PASS"

XWIKI_STANDARD_FLAVOR_ID="org.xwiki.platform:xwiki-platform-distribution-flavor-mainwiki"

COMMON_CURL_OPTIONS=(
    -d "extensionId=${XWIKI_STANDARD_FLAVOR_ID//:/%3A}"
    -d "extensionNamespace=wiki%3Axwiki"
    -d "extensionVersion=$XWIKI_VERSION"
)
EXT_COMMON_CURL_OPTIONS=(
    -d "extensionNamespace=wiki%3Axwiki"
    -d "section=XWiki.Extensions"
)

FORM_TOKEN=""
EXTENSION_INSTALLED=false

function check_ext_install_progress() {
    local extension_id="$1"
    local extension_version="$2"
    local action="$3"

    EXTENSION_INSTALLED=false

    while true; do
        local check_response percentage already_installed
        check_response=$(curl -sSL "$EXT_URL" \
            "${EXT_COMMON_CURL_OPTIONS[@]}" \
            -d "extensionId=$extension_id" \
            -d "extensionVersion=$extension_version" -u "$SUPER_ADMIN_AUTH")

        if [ "$action" == "install" ]; then
            local continue
            continue=$(echo "$check_response" | grep -oP 'extensionAction[^>]*value="continue"' || echo "")
            if [ -n "$continue" ]; then
                break
            fi
        else
            local installed
            installed=$(echo "$check_response" | grep -oP 'extension-status[^>]*>Installed<' || echo "")
            if [ -n "$installed" ]; then
                echo "[INFO] Extension successfully installed: $raw_extension_id ($extension_version)"
                break
            fi
        fi

        percentage=$(echo "$check_response" | grep -oP 'ui-progress-bar[^>]*width:\K[0-9]+' || echo "")
        already_installed=$(echo "$status_response" | grep -oP 'extension-status[^>]*>Installed<' || echo "")
        if [ -n "$already_installed" ]; then
            echo "[INFO] Extension already installed."
            EXTENSION_INSTALLED=true
            break
        fi
        if [ -z "$percentage" ]; then
            echo "[ERROR] Failed to retrieve installation progress."
        fi
        if [ -n "$percentage" ] && [ "$percentage" -ne "$install_progress" ]; then
            install_progress="$percentage"
            echo "  Progress: $install_progress%"
        fi
        sleep 5
    done
}

function install_extension() {
    local install_status continue_status
    local install_progress=0
    local raw_extension_id="$1"
    local extension_id="${raw_extension_id//:/%3A}"
    local extension_version="$2"

    echo "[INFO] Installing extension: $raw_extension_id ($extension_version)"

    install_status=$(curl -sSL -XPOST "$EXT_URL" \
        "${EXT_COMMON_CURL_OPTIONS[@]}" \
        -d "extensionAction=install" \
        -d "extensionId=$extension_id" \
        -d "extensionVersion=$extension_version" \
        -u "$SUPER_ADMIN_AUTH" -w "%{http_code}" -o /dev/null)

    if [ "$install_status" -ne 200 ]; then 
        echo "[ERROR] Failed to install extension. Code: $install_status"
        exit 1
    fi

    echo "[INFO] Downloading..."
    check_ext_install_progress "$extension_id" "$extension_version" "install"
    if [ "$EXTENSION_INSTALLED" = true ]; then
        return
    fi

    continue_status=$(curl -sSL -XPOST "$EXT_URL" \
        "${EXT_COMMON_CURL_OPTIONS[@]}" \
        -d "extensionAction=continue" \
        -d "form_token=$FORM_TOKEN" \
        -d "extensionId=$extension_id" \
        -d "extensionVersion=$extension_version" \
        -u "$SUPER_ADMIN_AUTH" -w "%{http_code}" -o /dev/null)

    if [ "$continue_status" -ne 200 ]; then 
        echo "[ERROR] Failed to continue extension installation. Code: $continue_status"
        exit 1
    fi

    # reset progress
    install_progress=0
    echo "[INFO] Installing..."
    check_ext_install_progress "$extension_id" "$extension_version" "continue"
}

function install_flavor() {
    local install_response server_error
    local flavor_loaded job_finished

    while true; do
        install_response=$(curl -sSL -XPOST "$DIST_URL" \
            "${COMMON_CURL_OPTIONS[@]}" \
            -d "extensionSection=progress" \
            -d "extensionAction=install" \
            -u "$SUPER_ADMIN_AUTH")

        server_error=$(echo "$install_response" | grep -oP 'Internal Server Error' || echo "")
        if [ -n "$server_error" ]; then
            echo "[ERROR] Internal Server Error."
            exit 1
        fi

        FORM_TOKEN=$(echo "$install_response" | grep -oP 'data-xwiki-form-token="\K[^"]+' || echo "")
        if [ -z "$FORM_TOKEN" ]; then
            echo "[ERROR] Failed to retrieve form token for continuing the installation."
            exit 1
        fi

        flavor_loaded=$(echo "$install_response" | grep -oP 'extension-title' || echo "")
        if [ -z "$flavor_loaded" ]; then
            echo "[INFO] Standard flavor not loaded yet..."
        fi

        local installplan_job="Finished job of type \[installplan\]"
        job_finished=$(echo "$install_response" | grep -oP "$installplan_job" || echo "")
        if [ -n "$job_finished" ]; then
            break
        else
            echo "[INFO] Standard flavor installation not ready yet..."
        fi

        sleep 5
    done

    local continue_status
    continue_status=$(curl -sSL -XPOST "$DIST_URL" \
        "${COMMON_CURL_OPTIONS[@]}" \
        -d "readOnly=false" \
        -d "form_token=$FORM_TOKEN" \
        -d "extensionAction=continue" \
        -u "$SUPER_ADMIN_AUTH" -w "%{http_code}" -o /dev/null)

    if [ "$continue_status" -ne 200 ]; then
        echo "[ERROR] Failed to continue the installation of the standard flavor. Code: $continue_status"
        exit 1
    fi

    ############################################
    # Wait for flavor installation to complete #
    ############################################
    local progress_percentage=0
    local already_installed
    local PATTERN="Finished job of type [install] with identifier [extension/action/$XWIKI_STANDARD_FLAVOR_ID/wiki:xwiki]"

    while true; do
        status_response=$(curl -sSL "$DIST_URL" -d "extensionSection=progress" "${COMMON_CURL_OPTIONS[@]}")

        if echo "$status_response" | grep -Fq "$PATTERN"; then
            echo "[INFO] Standard flavor installed."
            break
        fi

        percentage=$(echo "$status_response" | grep -oP 'ui-progress-bar[^>]*width:\K[0-9]+' || echo "")
        already_installed=$(echo "$status_response" | grep -oP 'extension-status[^>]*>Installed<' || echo "")
        if [ -n "$already_installed" ]; then
            echo "[INFO] Standard flavor already installed."
            break
        fi
        if [ -z "$percentage" ]; then
            echo "[ERROR] Failed to retrieve installation progress."
        fi
        if [ -n "$percentage" ] && [ "$percentage" -ne "$progress_percentage" ]; then
            progress_percentage="$percentage"
            echo "  Progress: $progress_percentage%"
        fi
        sleep 5
    done
}

function setup_openproject_connection() {
    local timestamp op_conn_id conn_status
    timestamp=$(date +%s%3N)
    op_conn_id="Connection$timestamp"
    conn_status=$(curl -sS -XPOST "$BASE_URL/rest/wikis/xwiki/spaces/OpenProject/spaces/Code/spaces/OpenProjectConfigurations/pages/$op_conn_id/openproject/configurations" \
        -H "Xwiki-Form-Token: $FORM_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"connectionName\": \"openproject\",
            \"serverURL\": \"$OPENPROJECT_HOST\",
            \"clientId\": \"$OPENPROJECT_CLIENT_ID\",
            \"clientSecret\": \"$OPENPROJECT_CLIENT_SECRET\"
        }" \
        -u "$SUPER_ADMIN_AUTH" -w "%{http_code}" -o /dev/null)

    # 409 Conflict can be returned if the connection already exists.
    if [ "$conn_status" -eq 201 ] || [ "$conn_status" -eq 409 ]; then
        echo "[INFO] OpenProject connection created successfully."
    else
        echo "[ERROR] Failed to create OpenProject connection. Code: $conn_status"
        exit 1
    fi
}

echo "############################################"
echo "# Install XWiki Standard Flavor            #"
echo "############################################"
echo "[INFO] Installing the standard flavor..."
install_flavor

echo "############################################"
echo "# Install OpenProject Extension            #"
echo "############################################"
install_extension "com.xwiki.projectmanagement:project-management-openproject-ui" "$EXTENSION_OPENPROJECT_VERSION"

echo "############################################"
echo "# Setup OpenProject Connection             #"
echo "############################################"
setup_openproject_connection

# let xwiki run in foreground
wait