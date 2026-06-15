#!/bin/bash

set -uo pipefail

BASE_URL="http://localhost:8080"
REST_URL="$BASE_URL/rest"
WEBAPPS_DIR=/usr/local/tomcat/webapps/ROOT/WEB-INF
XWIKI_VERSION=$(sed -n 's/^version=//p' $WEBAPPS_DIR/version.properties)
EXTENSION_REPO="/usr/local/xwiki/data/extension/repository"
FLAVOR_NAME="xwiki-platform-distribution-flavor-xip"
XWIKI_DOWNLOAD_URL="https://nexus.xwiki.org/nexus/content/repositories/releases/org/xwiki"

WIKI_INIT_MAX_ATTEMPTS=120
RETRY_MAX_ATTEMPTS=60
RETRY_SLEEP_SECONDS=5

if [ -z "$OPENPROJECT_HOST" ]; then
    echo "[ERROR] OPENPROJECT_HOST is not set."
    exit 1
fi

if [ -z "$OPENPROJECT_CLIENT_ID" ] || [ -z "$OPENPROJECT_CLIENT_SECRET" ]; then
    echo "[ERROR] OPENPROJECT_CLIENT_ID and OPENPROJECT_CLIENT_SECRET are not set."
    exit 1
fi

if [ -z "$EXTENSION_OPENPROJECT_VERSION" ]; then
    EXTENSION_OPENPROJECT_VERSION="1.1.1"
fi

wait_for_url() {
    local url="$1"
    local label="$2"
    local attempt=1

    while [ "$attempt" -le "$WIKI_INIT_MAX_ATTEMPTS" ]; do
        if curl -sf "$url" >/dev/null 2>&1; then
            echo "[INFO] $label is ready."
            return 0
        fi
        echo "[INFO] Waiting for $label... ($attempt/$WIKI_INIT_MAX_ATTEMPTS)"
        sleep "$RETRY_SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done

    echo "[ERROR] Timeout waiting for $label"
    return 1
}

echo "############################################"
echo "# Download XWiki Standard Flavor           #"
echo "############################################"
mkdir -p "$EXTENSION_REPO"
if [ -n "$(find "$EXTENSION_REPO" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    echo "[INFO] Extension repository already populated; skipping flavor download."
else
    curl -sSL "$XWIKI_DOWNLOAD_URL/platform/$FLAVOR_NAME/$XWIKI_VERSION/$FLAVOR_NAME-$XWIKI_VERSION.xip" \
        -o "$FLAVOR_NAME.xip"
    unzip -n -q "$FLAVOR_NAME.xip" -d "$EXTENSION_REPO"
    rm "$FLAVOR_NAME.xip"
    echo "[INFO] Standard flavor downloaded to $EXTENSION_REPO"
fi

echo "############################################"
echo "# Start XWiki With Standard Flavor         #"
echo "############################################"
/entrypoint/start.sh &

echo "[INFO] Waiting for XWiki REST API..."
wait_for_url "$REST_URL" "XWiki REST API" || true

echo "[INFO] Waiting for XWiki wiki initialization..."
wait_for_url "$BASE_URL/bin/view/Main/" "XWiki main wiki" || true

ADMIN_PASS=$(sed -n 's/^xwiki.superadminpassword=//p' $WEBAPPS_DIR/xwiki.cfg)
SUPER_ADMIN_AUTH="superadmin:$ADMIN_PASS"

EXT_REQ_BODY='
<jobRequest xmlns="http://www.xwiki.org">
  <id>
    <element>extension</element>
    <element>install</element>
    <element>%job_id%</element>
  </id>
  <interactive>false</interactive>
  <property>
    <key>extensions</key>
    <value>
      <list xmlns="">
        <org.xwiki.extension.ExtensionId>
          <id>%extension_id%</id>
          <version
            class="org.xwiki.extension.version.internal.DefaultVersion"
            serialization="custom">
            <org.xwiki.extension.version.internal.DefaultVersion>
              <string>%extension_version%</string>
            </org.xwiki.extension.version.internal.DefaultVersion>
          </version>
        </org.xwiki.extension.ExtensionId>
      </list>
    </value>
  </property>
  <property>
    <key>namespaces</key>
    <value>
      <list xmlns="">
        <string>wiki:xwiki</string>
      </list>
    </value>
  </property>
  <property>
    <key>user.reference</key>
    <value>
      <org.xwiki.model.reference.DocumentReference xmlns="">
        <name>superadmin</name>
      </org.xwiki.model.reference.DocumentReference>
    </value>
  </property>
</jobRequest>'

get_form_token() {
    local attempt=1 token=""

    while [ "$attempt" -le "$RETRY_MAX_ATTEMPTS" ]; do
        token=$(curl -sSI "$REST_URL" -u "$SUPER_ADMIN_AUTH" | grep -oP 'XWiki-Form-Token: \K[a-zA-Z0-9_-]+' || echo "")
        if [ -n "$token" ]; then
            echo "$token"
            return 0
        fi
        echo "[INFO] Waiting for XWiki form token... ($attempt/$RETRY_MAX_ATTEMPTS)"
        sleep "$RETRY_SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done

    return 1
}

function install_extension() {
    local ext_id="$1"
    local ext_version="$2"
    local job_suffix="$3"
    local attempt=1

    while [ "$attempt" -le "$RETRY_MAX_ATTEMPTS" ]; do
        local req_body install_status job_state status_response

        FORM_TOKEN=$(get_form_token) || FORM_TOKEN=""
        if [ -z "$FORM_TOKEN" ]; then
            echo "[INFO] Form token unavailable for extension install retry ($attempt/$RETRY_MAX_ATTEMPTS)."
            sleep "$RETRY_SLEEP_SECONDS"
            attempt=$((attempt + 1))
            continue
        fi

        req_body="${EXT_REQ_BODY//%job_id%/install-$job_suffix}"
        req_body="${req_body//%extension_id%/$ext_id}"
        req_body="${req_body//%extension_version%/$ext_version}"

        echo "[INFO] Installing extension: $ext_id ($ext_version) (attempt $attempt/$RETRY_MAX_ATTEMPTS)"

        install_status=$(curl -sS -XPUT "$REST_URL/jobs?jobType=install" -u "$SUPER_ADMIN_AUTH" \
            -H "XWiki-Form-Token: $FORM_TOKEN" \
            -H "Content-Type: text/xml" \
            -d "$req_body" \
            -w "%{http_code}" -o /dev/null)

        if [ "$install_status" -ne 200 ]; then
            echo "[WARN] Failed to start extension installation. Code: $install_status"
            sleep "$RETRY_SLEEP_SECONDS"
            attempt=$((attempt + 1))
            continue
        fi

        local install_percentage=0
        local job_attempts=0
        while [ "$job_attempts" -lt "$RETRY_MAX_ATTEMPTS" ]; do
            local current_offset percentage

            status_response=$(curl -sS "$REST_URL/jobstatus/extension/install/install-$job_suffix?media=json" -u "$SUPER_ADMIN_AUTH")
            job_state=$(echo "$status_response" | grep -oP 'state":"\K[A-Z]+' || echo "")

            if [ "$job_state" == "RUNNING" ]; then
                current_offset=$(echo "$status_response" | grep -oP 'currentLevelOffset":\K[0-9.]+' || echo 0)
                percentage=$(awk "BEGIN{printf \"%d\n\", $current_offset * 100}")
                if [ "$percentage" -ne "$install_percentage" ]; then
                    install_percentage="$percentage"
                    echo "  Progress: $install_percentage%"
                fi
            elif [ "$job_state" == "FINISHED" ]; then
                echo "[INFO] Successfully installed: $ext_id ($ext_version)"
                return 0
            elif [ "$job_state" != "NONE" ]; then
                echo "[WARN] Extension installation job failed: $status_response"
                break
            fi

            sleep "$RETRY_SLEEP_SECONDS"
            job_attempts=$((job_attempts + 1))
        done

        sleep "$RETRY_SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done

    echo "[ERROR] Giving up on extension install: $ext_id ($ext_version)"
    return 1
}

function setup_openproject_connection() {
    local attempt=1

    while [ "$attempt" -le "$RETRY_MAX_ATTEMPTS" ]; do
        local timestamp op_conn_id conn_status

        FORM_TOKEN=$(get_form_token) || FORM_TOKEN=""
        if [ -z "$FORM_TOKEN" ]; then
            echo "[INFO] Form token unavailable for OpenProject connection retry ($attempt/$RETRY_MAX_ATTEMPTS)."
            sleep "$RETRY_SLEEP_SECONDS"
            attempt=$((attempt + 1))
            continue
        fi

        timestamp=$(date +%s%3N)
        op_conn_id="Connection$timestamp"
        conn_status=$(curl -sS -XPOST "$REST_URL/wikis/xwiki/spaces/OpenProject/spaces/Code/spaces/OpenProjectConfigurations/pages/$op_conn_id/openproject/configurations" \
            -H "XWiki-Form-Token: $FORM_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{
                \"connectionName\": \"openproject\",
                \"serverURL\": \"$OPENPROJECT_HOST\",
                \"clientId\": \"$OPENPROJECT_CLIENT_ID\",
                \"clientSecret\": \"$OPENPROJECT_CLIENT_SECRET\"
            }" \
            -u "$SUPER_ADMIN_AUTH" -w "%{http_code}" -o /dev/null)

        if [ "$conn_status" -eq 201 ] || [ "$conn_status" -eq 409 ]; then
            echo "[INFO] OpenProject connection created successfully."
            return 0
        fi

        echo "[WARN] Failed to create OpenProject connection. Code: $conn_status (attempt $attempt/$RETRY_MAX_ATTEMPTS)"
        sleep "$RETRY_SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done

    echo "[ERROR] Giving up on OpenProject connection setup."
    return 1
}

echo "############################################"
echo "# Install OpenProject Extension            #"
echo "############################################"
install_extension "com.xwiki.projectmanagement:project-management-openproject-ui" "$EXTENSION_OPENPROJECT_VERSION" "openproject" || true
install_extension "com.xwiki.licensing:application-licensing-test-api" "1.32.2" "licensing-api" || true

echo "############################################"
echo "# Setup OpenProject Connection             #"
echo "############################################"
setup_openproject_connection || true

# Keep Tomcat in the foreground even when setup steps are still retrying or failed.
wait
