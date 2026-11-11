#!/bin/bash

set -eo pipefail

# Returns 0 when setup should talk to Nextcloud/OpenProject over in-cluster HTTP
# (k3d / PullPreview wait URLs) instead of public HTTPS (Caddy/LE).
should_use_incluster_api() {
    [[ "${1:-}" == http://* ]]
}

# Pin a public hostname to a Service ClusterIP so http://$public_host keeps the
# correct Host header for Nextcloud trusted_domains without going through TLS.
bind_public_host_to_service() {
    local public_host="$1"
    local service_dns="$2"
    local ip
    ip="$(getent ahostsv4 "$service_dns" | awk '{print $1; exit}')"
    if [[ -z "$ip" ]]; then
        echo "[ERROR] Could not resolve service '$service_dns' for host bind of '$public_host'." >&2
        return 1
    fi
    if grep -qE "[[:space:]]${public_host}$" /etc/hosts 2>/dev/null; then
        return 0
    fi
    echo "$ip $public_host" >> /etc/hosts
}

# OpenProject chart sets https:true, so plain http://openproject:8080 returns 400
# unless the request looks like it already passed a TLS terminator. Prefixed curl
# adds Host + X-Forwarded-Proto for OP service URLs only (NC uses /etc/hosts).
install_incluster_curl_wrapper() {
    [[ "${USE_INCLUSTER_API:-false}" == "true" ]] || return 0

    local wrap_dir="/tmp/opnc-curl-wrap"
    local real_curl
    real_curl="$(command -v curl)"
    mkdir -p "$wrap_dir"
    cat >"${wrap_dir}/curl" <<EOF
#!/bin/bash
extra=()
for a in "\$@"; do
  case "\$a" in
    http://openproject:8080*|http://openproject/*|http://openproject)
      extra=(-H "Host: ${OPENPROJECT_HOST}" -H "X-Forwarded-Proto: https" -H "X-Forwarded-Host: ${OPENPROJECT_HOST}")
      break
      ;;
  esac
done
exec "${real_curl}" "\${extra[@]}" "\$@"
EOF
    chmod +x "${wrap_dir}/curl"
    export PATH="${wrap_dir}:${PATH}"
    echo "[INFO] Installed curl wrapper for in-cluster OpenProject (X-Forwarded-Proto: https)."
}

# When waits are already in-cluster HTTP, route API calls the same way so setup
# does not depend on public Caddy/LE TLS. Identity URLs stay in NC_PUBLIC/OP_PUBLIC.
#
# Nextcloud: bind the public hostname to the Service IP so http://$NEXTCLOUD_HOST
# keeps Host correct for trusted_domains. OpenProject: Service DNS + curl wrapper
# (https:true rejects bare http without forwarded proto).
use_incluster_api_hosts() {
    should_use_incluster_api "${NEXTCLOUD_WAIT_URL:-}" || return 0

    NC_PUBLIC="$NC_HOST"
    OP_PUBLIC="$OP_HOST"
    bind_public_host_to_service "$NEXTCLOUD_HOST" nextcloud
    export NC_HOST="http://$NEXTCLOUD_HOST"
    export OP_HOST="http://openproject:8080"
    USE_INCLUSTER_API=true
    install_incluster_curl_wrapper
    echo "[INFO] Using in-cluster API hosts (NC_HOST=$NC_HOST OP_HOST=$OP_HOST); identity URLs remain $NC_PUBLIC / $OP_PUBLIC."
}

# Upstream setup scripts use NC_HOST/OP_HOST (or NEXTCLOUD_HOST/OPENPROJECT_HOST)
# for both API curls and stored identity. Rewrite identity JSON to public HTTPS.
patch_integration_script_public_identity() {
    local script="$1"
    [[ "${USE_INCLUSTER_API:-false}" == "true" ]] || return 0

    # .bak suffix keeps sed -i portable across GNU (cluster) and BSD (local test).
    sed -i.bak \
        -e "s|\"redirectUri\": \"\$OP_HOST/\*\"|\"redirectUri\": \"${OP_PUBLIC}/*\"|" \
        -e "s|\"href\": \"\${NC_HOST}\"|\"href\": \"${NC_PUBLIC}\"|" \
        -e "s|\"openproject_instance_url\": \"\$OP_HOST\"|\"openproject_instance_url\": \"${OP_PUBLIC}\"|" \
        -e "s|\"href\":\"\${NEXTCLOUD_HOST}\"|\"href\":\"${NC_PUBLIC}\"|" \
        -e "s|\"openproject_instance_url\":\"\${OPENPROJECT_HOST}\"|\"openproject_instance_url\":\"${OP_PUBLIC}\"|" \
        "$script"
    rm -f "${script}.bak"
    echo "[INFO] Patched ${script} identity URLs to public HTTPS."
}

# Sourced by setup-integration-incluster.test.sh — skip main when not executed.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
    return 0
fi

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
USE_INCLUSTER_API=false

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

# After readiness (and optional public checks), switch API traffic in-cluster so
# OCS/setup curls do not need a working Let's Encrypt cert on the public hosts.
use_incluster_api_hosts

if [[ "$INTEGRATION_APP_SETUP_METHOD" == "oauth2" ]]; then
    download_integration_script integration_setup.sh
    patch_integration_script_public_identity integration_setup.sh

    if [[ "${USE_INCLUSTER_API}" == "true" ]]; then
        OPENPROJECT_HOST="$OP_HOST" \
        NEXTCLOUD_HOST="$NC_HOST" \
        OPENPROJECT_STORAGE_NAME='nextcloud' \
        bash integration_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure
    else
        OPENPROJECT_HOST="https://$OPENPROJECT_HOST" \
        NEXTCLOUD_HOST="https://$NEXTCLOUD_HOST" \
        OPENPROJECT_STORAGE_NAME='nextcloud' \
        bash integration_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure
    fi

elif [[ "$INTEGRATION_APP_SETUP_METHOD" == "sso-nextcloud" ]]; then
    download_integration_script integration_oidc_setup.sh
    patch_integration_oidc_setup_script
    patch_integration_script_public_identity integration_oidc_setup.sh

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
    patch_integration_script_public_identity integration_oidc_setup.sh

    NC_INTEGRATION_PROVIDER_TYPE=external \
    NC_INTEGRATION_PROVIDER_NAME=$OIDC_KEYCLOAK_PROVIDER_NAME \
    NC_INTEGRATION_OP_CLIENT_ID=$OIDC_OPENPROJECT_CLIENT_ID \
    NC_INTEGRATION_TOKEN_EXCHANGE=true \
    OP_STORAGE_AUDIENCE=nextcloud \
    OP_STORAGE_SCOPE=add-nc-aud \
    bash integration_oidc_setup.sh 2>&1 | tee "$INTEGRATION_SETUP_LOG" || _handle_integration_script_failure
fi
