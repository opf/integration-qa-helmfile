#!/bin/bash

set -uo pipefail

start_time=$SECONDS

XWIKI_LOG_FILE="/xwiki-install.log"
READY_FILE="/xwiki-ready"
# remove ready indicator file to ensure a clean state for readiness probe
rm -f "$READY_FILE"

BASE_URL="http://localhost:8080"
REST_URL="$BASE_URL/rest"
WEBAPPS_DIR=/usr/local/tomcat/webapps/ROOT/WEB-INF
XWIKI_VERSION=$(sed -n 's/^version=//p' $WEBAPPS_DIR/version.properties)
EXTENSION_REPO="/usr/local/xwiki/data/extension/repository"
FLAVOR_NAME="xwiki-platform-distribution-flavor-xip"
XWIKI_DOWNLOAD_URL="https://nexus.xwiki.org/nexus/content/repositories/releases/org/xwiki"

RETRY_API_CHECK_MAX_ATTEMPTS=10
RETRY_MAX_ATTEMPTS=60
RETRY_SLEEP_SECONDS=5

if [ -z "$OPENPROJECT_HOST" ]; then
    echo "[ERROR] OPENPROJECT_HOST is not set."
    exit 1
fi

if [ -z "$XWIKI_OAUTH_CLIENT_ID" ] || [ -z "$XWIKI_OAUTH_CLIENT_SECRET" ]; then
    echo "[ERROR] XWIKI_OAUTH_CLIENT_ID or XWIKI_OAUTH_CLIENT_SECRET is not set."
    exit 1
fi

if [ -z "$OPENPROJECT_OAUTH_CLIENT_ID" ] || [ -z "$OPENPROJECT_OAUTH_CLIENT_SECRET" ]; then
    echo "[ERROR] OPENPROJECT_OAUTH_CLIENT_ID or OPENPROJECT_OAUTH_CLIENT_SECRET is not set."
    exit 1
fi

if [ -z "$EXTENSION_OPENPROJECT_VERSION" ]; then
    EXTENSION_OPENPROJECT_VERSION="1.2.0"
fi

wait_xwiki_installation() {
    local install_job_started=""
    local installing_doc=""
    local install_complete=""
    local ext_install_error=""
    local job_init_timeout=600  # 10 minutes timeout for XWiki job initialization
    local s_time=$SECONDS
    local sleep_time=30

    while true; do
        if [ -z "$install_job_started" ]; then
            install_job_started=$(grep "Starting job of type \[install\]" "$XWIKI_LOG_FILE")
        fi
        if [ -z "$installing_doc" ]; then
            installing_doc=$(grep "Installing document" "$XWIKI_LOG_FILE")
        fi
        install_complete=$(grep "Finished job of type \[install\]" "$XWIKI_LOG_FILE")
        ext_install_error=$(grep "Failed to send Active Installation ping" "$XWIKI_LOG_FILE")

        if [ -n "$install_complete" ] && [ -n "$ext_install_error" ]; then
            echo "[INFO] XWiki installation failed with errors."
            exit 1
        fi
        if [ -n "$install_complete" ]; then
            echo "[INFO] XWiki installation completed."
            return 0
        fi

        elapsed_time=$((SECONDS - s_time))
        # gradually reduce sleep time as the elapsed time increases
        # to check more frequently during the end of the installation process.
        if [ $elapsed_time -gt 600 ]; then # after 10 minutes
            sleep_time=20
        elif [ $elapsed_time -gt 1200 ]; then # after 20 minutes
            sleep_time=15
        elif [ $elapsed_time -gt 1500 ]; then # after 25 minutes
            sleep_time=10
        elif [ $elapsed_time -gt 1800 ]; then # after 30 minutes
            sleep_time=5
        fi

        if [ -n "$install_job_started" ] || [ -n "$installing_doc" ]; then
            sleep $sleep_time
        else
            if [ $elapsed_time -ge $job_init_timeout ]; then
                echo "[ERROR] XWiki install job did not start within $job_init_timeout seconds."
                exit 1
            fi
            sleep $sleep_time
        fi
    done
}

wait_for_url() {
    local url="$1"
    local label="$2"
    local attempt=1

    while [ "$attempt" -le "$RETRY_API_CHECK_MAX_ATTEMPTS" ]; do
        if curl -sf "$url" >/dev/null 2>&1; then
            echo "[INFO] $label is ready."
            return 0
        fi
        echo "[INFO] Waiting for $label... ($attempt/$RETRY_API_CHECK_MAX_ATTEMPTS)"
        sleep "$RETRY_SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done

    echo "[ERROR] Timeout waiting for $label"
    exit 1
}

wait_for_openproject_metadata() {
    local url="$REST_URL/openproject/metadata"
    local attempt=1

    while [ "$attempt" -le "$RETRY_API_CHECK_MAX_ATTEMPTS" ]; do
        if curl -sf "$url" | grep -q '"instanceId"'; then
            echo "[INFO] OpenProject metadata endpoint is ready."
            return 0
        fi
        echo "[INFO] Waiting for OpenProject metadata endpoint... ($attempt/$RETRY_API_CHECK_MAX_ATTEMPTS)"
        sleep "$RETRY_SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done

    echo "[ERROR] Timeout waiting for OpenProject metadata endpoint at $url"
    return 1
}

echo "############################################"
echo "# Download XWiki Standard Flavor           #"
echo "############################################"
mkdir -p "$EXTENSION_REPO"
SKIP_INSTALLATION_CHECK="no"
if [ -n "$(find "$EXTENSION_REPO" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    SKIP_INSTALLATION_CHECK="yes"
    echo "[INFO] Extension repository already populated; skipping flavor download."
else
    curl -sSL "$XWIKI_DOWNLOAD_URL/platform/$FLAVOR_NAME/$XWIKI_VERSION/$FLAVOR_NAME-$XWIKI_VERSION.xip" \
        -o "$FLAVOR_NAME.xip"
    unzip -n -q "$FLAVOR_NAME.xip" -d "$EXTENSION_REPO"
    rm "$FLAVOR_NAME.xip"
    echo "[INFO] Standard flavor downloaded to $EXTENSION_REPO"
fi

if [ -n "$CURL_CA_BUNDLE" ]; then
    echo ""
    echo "############################################"
    echo "# Import CA Certificate to Java Keystore   #"
    echo "############################################"
    keytool \
        --importcert \
        -noprompt \
        -trustcacerts \
        -alias ingress-ca \
        -file /certs/ca.crt \
        -cacerts \
        -storepass changeit
fi

echo ""
echo "############################################"
echo "# Start XWiki With Standard Flavor         #"
echo "############################################"
/entrypoint/start.sh | tee -a "$XWIKI_LOG_FILE" 2>&1 &

if [ "$SKIP_INSTALLATION_CHECK" = "no" ]; then
    wait_xwiki_installation

    ready_time=$SECONDS
    echo ""
    echo "[INFO] XWiki is ready. Total time: $((ready_time - start_time)) seconds."
    echo ""
fi

echo "[INFO] Waiting for XWiki REST API..."
wait_for_url "$REST_URL/wikis/xwiki/spaces" "XWiki REST API"

echo "[INFO] Waiting for XWiki main wiki..."
wait_for_url "$BASE_URL/bin/view/Main/" "XWiki main wiki"

# To let k8s know that the wiki is ready,
# we create a file that is checked by the readiness probe
touch "$READY_FILE"

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
      %namespaces%
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
    local namespace="${4:-wiki:xwiki}"
    local attempt=1
    local namespaces_block

    if [ -z "$namespace" ]; then
        namespaces_block='<list xmlns=""/>'
    else
        namespaces_block="<list xmlns=\"\"><string>${namespace}</string></list>"
    fi

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
        req_body="${req_body//%namespaces%/$namespaces_block}"

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
                \"clientId\": \"$XWIKI_OAUTH_CLIENT_ID\",
                \"clientSecret\": \"$XWIKI_OAUTH_CLIENT_SECRET\"
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

function add_openproject_oidc_client() {
    local attempt=1

    while [ "$attempt" -le "$RETRY_MAX_ATTEMPTS" ]; do
        local client_status

        FORM_TOKEN=$(get_form_token) || FORM_TOKEN=""
        if [ -z "$FORM_TOKEN" ]; then
            echo "[INFO] Form token unavailable. Retrying ($attempt/$RETRY_MAX_ATTEMPTS)."
            sleep "$RETRY_SLEEP_SECONDS"
            attempt=$((attempt + 1))
            continue
        fi

        client_status=$(curl -sS -XPOST "$REST_URL/wikis/xwiki/spaces/XWiki/spaces/OIDC/spaces/Provider/pages/Clients/objects" \
            -H "XWiki-Form-Token: $FORM_TOKEN" \
            -H "Content-Type: application/x-www-form-urlencoded" \
            -d "className=XWiki.OIDC.Provider.ClientClass" \
            -d "property#id=$OPENPROJECT_OAUTH_CLIENT_ID" \
            -d "property#secret=$OPENPROJECT_OAUTH_CLIENT_SECRET" \
            -d "property#redirectURIs=$OPENPROJECT_HOST/oauth_clients/openproject-$OPENPROJECT_OAUTH_CLIENT_ID/callback" \
            -d "property#enabled=1" \
            -u "$SUPER_ADMIN_AUTH" -w "%{http_code}" -o /dev/null)

        if [ "$client_status" -eq 201 ] || [ "$client_status" -eq 409 ]; then
            echo "[INFO] OIDC client registered successfully."
            return 0
        fi

        echo "[WARN] Failed to register OIDC client. Code: $client_status (attempt $attempt/$RETRY_MAX_ATTEMPTS)"
        sleep "$RETRY_SLEEP_SECONDS"
        attempt=$((attempt + 1))
    done

    echo "[ERROR] Giving up on OIDC client registration."
    return 1
}

echo "############################################"
echo "# Install OpenProject Extensions           #"
echo "############################################"
install_extension "com.xwiki.licensing:application-licensing-test-api" "1.32.3" "licensing-api" "wiki:xwiki"
install_extension "com.xwiki.projectmanagement:project-management-openproject-ui" "$EXTENSION_OPENPROJECT_VERSION" "openproject-ui" "wiki:xwiki"

echo "############################################"
echo "# Verify OpenProject Metadata Endpoint     #"
echo "############################################"
wait_for_openproject_metadata

echo "############################################"
echo "# Setup OpenProject Connection             #"
echo "############################################"
setup_openproject_connection || true

add_openproject_oidc_client || true

# Keep Tomcat in the foreground even when setup steps are still retrying or failed.
wait
