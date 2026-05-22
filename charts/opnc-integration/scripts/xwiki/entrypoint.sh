#!/bin/bash

set -e

BASE_URL="http://localhost:8080/rest"
WEBAPPS_DIR=/usr/local/tomcat/webapps/ROOT/WEB-INF
XWIKI_VERSION=$(sed -n 's/^version=//p' $WEBAPPS_DIR/version.properties)
EXTENSION_REPO="/usr/local/xwiki/data/extension/repository"
FLAVOR_NAME="xwiki-platform-distribution-flavor-xip"
XWIKI_DOWNLOAD_URL="https://nexus.xwiki.org/nexus/content/repositories/releases/org/xwiki"

# extensions
XWIKI_STANDARD_FLAVOR_ID="org.xwiki.platform:xwiki-platform-distribution-flavor-mainwiki"
OPENPROJECT_EXTENSION_ID="com.xwiki.projectmanagement:project-management-openproject-ui"

if [ -z "$OPENPROJECT_HOST" ]; then
    echo "[ERROR] OPENPROJECT_HOST is not set."
    exit 1
fi

if [ -z "$OPENPROJECT_CLIENT_ID" ] || [ -z "$OPENPROJECT_CLIENT_SECRET" ]; then
    echo "[ERROR] OPENPROJECT_CLIENT_ID and OPENPROJECT_CLIENT_SECRET are not set."
    exit 1
fi

if [ -z "$EXTENSION_OPENPROJECT_VERSION" ]; then
    EXTENSION_OPENPROJECT_VERSION="1.1.0"
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
until curl -sL "$BASE_URL" > /dev/null; do
    sleep 5
done

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
</jobRequest>'

function install_extension() {
    local req_body install_status
    local ext_id="$1"
    local ext_version="$2"
    local job_id="install-$3"

    req_body="${EXT_REQ_BODY//%job_id%/$job_id}"
    req_body="${req_body//%extension_id%/$ext_id}"
    req_body="${req_body//%extension_version%/$ext_version}"

    install_status=$(curl -sS -XPUT "$BASE_URL/jobs?jobType=install" -u "$SUPER_ADMIN_AUTH" \
    -H"Xwiki-Form-Token: $FORM_TOKEN" \
    -H"Content-Type: text/xml" \
    -d "$req_body" \
    -w "%{http_code}" -o /dev/null)

    if [ "$install_status" -ne 200 ]; then
        echo "[ERROR] Failed to start extension installation. Code: $install_status"
        exit 1
    fi

    local install_percentage=0
    while true; do
        local status_response job_state offset current_offset percentage

        status_response=$(curl -sS "$BASE_URL/jobstatus/extension/install/install-$3?media=json" -u "$SUPER_ADMIN_AUTH")

        job_state=$(echo "$status_response" | grep -oP 'state": "\K[A-Z]+')
        if [ "$job_state" == "RUNNING" ]; then
            offset=$(echo "$status_response" | grep -oP 'offset": \K[0-9.]+')
            current_offset=$(echo "$status_response" | grep -oP 'currentLevelOffset": \K[0-9.]+')
            percentage=$((current_offset * 100 / offset))
            percentage=${percentage%.*} # remove decimal part

            if [ "$percentage" -ne "$install_percentage" ]; then
                install_percentage="$percentage"
                echo "  Progress: $install_percentage%"
            fi
        elif [ "$job_state" == "FINISHED" ]; then
            echo "[INFO] Successfully installed: $ext_id ($ext_version)"
            break
        else
            echo "[ERROR] Extension installation failed: $status_response"
            exit 1
        fi
        sleep 5
    done
}

function setup_openproject_connection() {
    local timestamp op_conn_id conn_status
    timestamp=$(date +%s%3N)
    op_conn_id="Connection$timestamp"
    conn_status=$(curl -sS -XPOST "$BASE_URL/wikis/xwiki/spaces/OpenProject/spaces/Code/spaces/OpenProjectConfigurations/pages/$op_conn_id/openproject/configurations" \
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

# Get the form token for the superadmin user
FORM_TOKEN=$(curl -sSI "$BASE_URL" -u "$SUPER_ADMIN_AUTH" | grep -oP 'Xwiki-Form-Token: \K[a-zA-Z0-9_-]+' || echo "")
if [ -z "$FORM_TOKEN" ]; then
    echo "[ERROR] Failed to retrieve form token."
    exit 1
fi

echo "############################################"
echo "# Install XWiki Standard Flavor            #"
echo "############################################"
echo "[INFO] Installing the standard flavor..."
install_extension "$XWIKI_STANDARD_FLAVOR_ID" "$XWIKI_VERSION" "flavor"

echo "############################################"
echo "# Install OpenProject Extension            #"
echo "############################################"
echo "[INFO] Installing extension: $OPENPROJECT_EXTENSION_ID ($EXTENSION_OPENPROJECT_VERSION)"
install_extension "$OPENPROJECT_EXTENSION_ID" "$EXTENSION_OPENPROJECT_VERSION" "openproject"

echo "############################################"
echo "# Setup OpenProject Connection             #"
echo "############################################"
setup_openproject_connection

# let xwiki run in foreground
wait