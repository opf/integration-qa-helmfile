#!/bin/sh
# Realm bootstrap for the Keycloak sidecar (main container runs start against Postgres).
# Talks to Keycloak on localhost:8080 (shared pod network).
# Creates realm/users/clients if missing, then always resets passwords and client secrets
# from env so secret rotation works without wiping kc-postgresql.
# Invoked as /bin/sh (setup image); keep POSIX — no bash arrays.

set -eu

# From secretKeyRef / chart env — no soft defaults (missing secrets fail the pod).
: "${KC_BOOTSTRAP_ADMIN_USERNAME:?KC_BOOTSTRAP_ADMIN_USERNAME is required}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?KC_BOOTSTRAP_ADMIN_PASSWORD is required}"
: "${KC_REALM_USER_PASSWORD:?KC_REALM_USER_PASSWORD is required}"

KEYCLOAK_URL="http://127.0.0.1:8080"
echo "Waiting for Keycloak at ${KEYCLOAK_URL}..."
until curl -sf "${KEYCLOAK_URL}/realms/master" >/dev/null; do
  sleep 2
done
echo "Keycloak is up."

echo "Obtaining admin token..."
ADMIN_TOKEN="$(
  curl -sf -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=${KC_BOOTSTRAP_ADMIN_USERNAME}" \
    -d "password=${KC_BOOTSTRAP_ADMIN_PASSWORD}" \
    -d "grant_type=password" \
    -d "client_id=admin-cli" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
)"
if [ -z "${ADMIN_TOKEN}" ]; then
  echo "Failed to obtain admin token (rotating PULLPREVIEW_ADMIN_PASSWORD requires wiping kc-postgresql PVC)" >&2
  exit 1
fi

AUTH_H="Authorization: Bearer ${ADMIN_TOKEN}"

echo "Creating realm '${KC_REALM_NAME}'..."
curl -sf -X POST "${KEYCLOAK_URL}/admin/realms" \
  -H "${AUTH_H}" \
  -H "Content-Type: application/json" \
  -d "{
    \"realm\": \"${KC_REALM_NAME}\",
    \"enabled\": true,
    \"registrationEmailAsUsername\": false,
    \"loginWithEmailAllowed\": true,
    \"duplicateEmailsAllowed\": false,
    \"resetPasswordAllowed\": true,
    \"editUsernameAllowed\": true,
    \"bruteForceProtected\": true
}" || echo "Realm may already exist (continuing)"

# Existing DBs may still have email-as-username; E2E logs in as alice/brian.
realm_body="$(curl -sf "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}" -H "${AUTH_H}" | tr -d '\n')"
realm_body="$(printf '%s' "${realm_body}" \
  | sed 's/"registrationEmailAsUsername":true/"registrationEmailAsUsername":false/')"
curl -sf -X PUT "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}" \
  -H "${AUTH_H}" \
  -H "Content-Type: application/json" \
  -d "${realm_body}"
echo "Ensured registrationEmailAsUsername=false"

COMMON_USER_ATTRIBUTES='
"emailVerified": true,
"enabled": true,
"credentials": [
    {
        "type": "password",
        "value": "'"${KC_REALM_USER_PASSWORD}"'",
        "temporary": false
    }
]'

echo "Creating users..."
curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/users" \
  -H "${AUTH_H}" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"alice\",
    \"firstName\": \"Alice\",
    \"lastName\": \"Hansen\",
    \"email\": \"alice@example.com\",
    ${COMMON_USER_ATTRIBUTES}
}" || echo "User alice may already exist"

curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/users" \
  -H "${AUTH_H}" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"brian\",
    \"firstName\": \"Brian\",
    \"lastName\": \"Murphy\",
    \"email\": \"brian@example.com\",
    ${COMMON_USER_ATTRIBUTES}
}" || echo "User brian may already exist"

# First "id":"..." only (greedy .* would take a nested/last id and 404 on PUT).
json_first_id() {
  tr -d '\n' | sed 's/"id":"/\n/' | sed -n '2s/\([^"]*\)".*/\1/p'
}

# Split a JSON array of objects on "},{" so name filters stay object-local.
json_objects() {
  tr -d '\n' | sed 's/^\[//;s/\]$//;s/},{/}\n{/g'
}

resolve_scope_uuid() {
  scope_name="$1"
  curl -sf "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/client-scopes" \
    -H "${AUTH_H}" \
    | json_objects \
    | grep "\"name\":\"${scope_name}\"" \
    | json_first_id
}

# Create-or-find a client scope with an audience mapper for audience_client_id.
ensure_client_scope() {
  scope_name="$1"
  audience_client_id="$2"
  code="$(
    curl -sS -o /tmp/kc-scope-create.out -w '%{http_code}' -X POST \
      "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/client-scopes" \
      -H "${AUTH_H}" \
      -H "Content-Type: application/json" \
      -d "{
        \"name\": \"${scope_name}\",
        \"protocol\": \"openid-connect\",
        \"attributes\": {\"include.in.token.scope\": \"true\"},
        \"protocolMappers\": [
          {
            \"name\": \"${audience_client_id}_aud_mapper\",
            \"protocol\": \"openid-connect\",
            \"protocolMapper\": \"oidc-audience-mapper\",
            \"config\": {
              \"included.client.audience\": \"${audience_client_id}\",
              \"access.token.claim\": \"true\"
            }
          }
        ]
      }"
  )"
  if [ "${code}" != "201" ] && [ "${code}" != "409" ]; then
    echo "Failed to create client scope '${scope_name}' (HTTP ${code}): $(cat /tmp/kc-scope-create.out)" >&2
    return 1
  fi
  scope_id="$(resolve_scope_uuid "${scope_name}")"
  if [ -z "${scope_id}" ]; then
    echo "Could not resolve client scope id for '${scope_name}'" >&2
    return 1
  fi
  echo "Ensured client scope '${scope_name}' (${scope_id})" >&2
  printf '%s' "${scope_id}"
}

# Default (not optional): OP/NC tokens must carry the aud mapper without clients asking for the scope.
add_default_scope_to_client() {
  client_uuid="$1"
  scope_uuid="$2"
  label="$3"
  # Drop optional attach if a prior run left it there.
  curl -sS -o /dev/null -X DELETE \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${client_uuid}/optional-client-scopes/${scope_uuid}" \
    -H "${AUTH_H}" || true
  code="$(
    curl -sS -o /tmp/kc-scope-attach.out -w '%{http_code}' -X PUT \
      "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${client_uuid}/default-client-scopes/${scope_uuid}" \
      -H "${AUTH_H}"
  )"
  if [ "${code}" = "204" ]; then
    echo "Attached default scope to ${label}"
    return 0
  fi
  if curl -sf \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${client_uuid}/default-client-scopes" \
    -H "${AUTH_H}" \
    | grep -q "\"id\":\"${scope_uuid}\""; then
    echo "Default scope already on ${label}"
    return 0
  fi
  echo "Failed to attach default scope to ${label} (HTTP ${code}): $(cat /tmp/kc-scope-attach.out)" >&2
  return 1
}

reset_user_password() {
  username="$1"
  email="$2"
  first_name="$3"
  last_name="$4"
  # registrationEmailAsUsername realms may store email as username; try both.
  user_id="$(
    curl -sf -G "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/users" \
      -H "${AUTH_H}" \
      --data-urlencode "username=${username}" --data-urlencode "exact=true" \
      | json_first_id
  )"
  if [ -z "${user_id}" ]; then
    user_id="$(
      curl -sf -G "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/users" \
        -H "${AUTH_H}" \
        --data-urlencode "email=${email}" --data-urlencode "exact=true" \
        | json_first_id
    )"
  fi
  if [ -z "${user_id}" ]; then
    user_id="$(
      curl -sf -G "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/users" \
        -H "${AUTH_H}" \
        --data-urlencode "search=${email}" --data-urlencode "max=1" \
        | json_first_id
    )"
  fi
  if [ -z "${user_id}" ]; then
    echo "Could not resolve user id for ${username} (${email})" >&2
    return 1
  fi
  # Force short username when an older realm stored the email as username.
  curl -sf -X PUT \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/users/${user_id}" \
    -H "${AUTH_H}" \
    -H "Content-Type: application/json" \
    -d "{
      \"username\": \"${username}\",
      \"email\": \"${email}\",
      \"firstName\": \"${first_name}\",
      \"lastName\": \"${last_name}\",
      \"emailVerified\": true,
      \"enabled\": true
    }"
  curl -sf -X PUT \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/users/${user_id}/reset-password" \
    -H "${AUTH_H}" \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"password\",
      \"value\": \"${KC_REALM_USER_PASSWORD}\",
      \"temporary\": false
    }"
  echo "Reset password for ${username}"
}

echo "Syncing realm user passwords from env..."
reset_user_password alice alice@example.com Alice Hansen
reset_user_password brian brian@example.com Brian Murphy

echo "Creating clients..."
curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients" \
  -H "${AUTH_H}" \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"openid-connect\",
    \"clientId\": \"${KC_NEXTCLOUD_CLIENT_ID}\",
    \"name\": \"Nextcloud client\",
    \"description\": \"Client for Nextcloud\",
    \"enabled\": true,
    \"publicClient\": false,
    \"clientAuthenticatorType\": \"client-secret\",
    \"secret\": \"${KC_NEXTCLOUD_CLIENT_SECRET}\",
    \"redirectUris\": [
        \"https://${KC_NEXTCLOUD_CLIENT_HOST}/*\"
    ],
    \"webOrigins\": [
        \"https://${KC_NEXTCLOUD_CLIENT_HOST}\"
    ],
    \"standardFlowEnabled\": true,
    \"directAccessGrantsEnabled\": true,
    \"serviceAccountsEnabled\": true,
    \"attributes\": {
        \"oauth2.device.authorization.grant.enabled\": \"true\",
        \"standard.token.exchange.enabled\": \"true\",
        \"standard.token.exchange.enableRefreshRequestedTokenType\": \"SAME_SESSION\"
    }
}" || echo "Nextcloud client may already exist"

curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients" \
  -H "${AUTH_H}" \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"openid-connect\",
    \"clientId\": \"${KC_OPENPROJECT_CLIENT_ID}\",
    \"name\": \"OpenProject client\",
    \"description\": \"Client for OpenProject\",
    \"enabled\": true,
    \"publicClient\": false,
    \"clientAuthenticatorType\": \"client-secret\",
    \"secret\": \"${KC_OPENPROJECT_CLIENT_SECRET}\",
    \"redirectUris\": [
        \"https://${KC_OPENPROJECT_CLIENT_HOST}/*\"
    ],
    \"webOrigins\": [
        \"https://${KC_OPENPROJECT_CLIENT_HOST}\"
    ],
    \"standardFlowEnabled\": true,
    \"directAccessGrantsEnabled\": true,
    \"serviceAccountsEnabled\": true,
    \"attributes\": {
        \"oauth2.device.authorization.grant.enabled\": \"true\",
        \"standard.token.exchange.enabled\": \"true\",
        \"standard.token.exchange.enableRefreshRequestedTokenType\": \"SAME_SESSION\"
    }
}" || echo "OpenProject client may already exist"

resolve_client_uuid() {
  client_id="$1"
  curl -sf -G "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients" \
    -H "${AUTH_H}" \
    --data-urlencode "clientId=${client_id}" \
    | json_first_id
}

set_client_secret() {
  client_uuid="$1"
  secret="$2"
  label="$3"
  body="$(
    curl -sf \
      "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${client_uuid}" \
      -H "${AUTH_H}" | tr -d '\n'
  )"
  # Drop any existing secret field (string or null), then inject desired value.
  body="$(printf '%s' "${body}" \
    | sed -e 's/,"secret":"[^"]*"//g' -e 's/"secret":"[^"]*",//g' \
          -e 's/,"secret":null//g' -e 's/"secret":null,//g')"
  body="$(printf '%s' "${body}" | sed "s/}$/,\"secret\":\"${secret}\"}/")"
  code="$(
    curl -sS -o /tmp/kc-client-put.out -w '%{http_code}' -X PUT \
      "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${client_uuid}" \
      -H "${AUTH_H}" \
      -H "Content-Type: application/json" \
      -d "${body}"
  )"
  if [ "${code}" != "204" ] && [ "${code}" != "200" ]; then
    echo "Failed to sync client secret for ${label} (HTTP ${code}): $(cat /tmp/kc-client-put.out)" >&2
    return 1
  fi
  echo "Synced client secret for ${label}"
}

# Inject TE attrs into a client JSON body. Keep in sync with keycloak-te.test.sh.
# Empty attributes:{} must not leave a trailing comma (illegal JSON).
inject_standard_token_exchange_attrs() {
  body="$1"
  case "${body}" in
    *"\"standard.token.exchange.enabled\""*)
      printf '%s' "${body}"
      return 0
      ;;
  esac
  case "${body}" in
    *"\"attributes\":{}"*)
      printf '%s' "${body}" | sed \
        's/"attributes":{}/"attributes":{"standard.token.exchange.enabled":"true","standard.token.exchange.enableRefreshRequestedTokenType":"SAME_SESSION"}/'
      ;;
    *)
      printf '%s' "${body}" | sed \
        's/"attributes":{/"attributes":{"standard.token.exchange.enabled":"true","standard.token.exchange.enableRefreshRequestedTokenType":"SAME_SESSION",/'
      ;;
  esac
}

# Idempotent for clients created before TE attrs were in the POST body.
ensure_standard_token_exchange() {
  client_uuid="$1"
  label="$2"
  body="$(
    curl -sf \
      "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${client_uuid}" \
      -H "${AUTH_H}" | tr -d '\n'
  )"
  new_body="$(inject_standard_token_exchange_attrs "${body}")"
  if [ "${new_body}" = "${body}" ]; then
    echo "Standard token exchange already set on ${label}"
    return 0
  fi
  code="$(
    curl -sS -o /tmp/kc-te-put.out -w '%{http_code}' -X PUT \
      "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${client_uuid}" \
      -H "${AUTH_H}" \
      -H "Content-Type: application/json" \
      -d "${new_body}"
  )"
  if [ "${code}" != "204" ] && [ "${code}" != "200" ]; then
    echo "Failed to enable standard token exchange on ${label} (HTTP ${code}): $(cat /tmp/kc-te-put.out)" >&2
    return 1
  fi
  echo "Ensured standard token exchange on ${label}"
}

OP_CLIENT_UUID="$(resolve_client_uuid "${KC_OPENPROJECT_CLIENT_ID}")"
NC_CLIENT_UUID="$(resolve_client_uuid "${KC_NEXTCLOUD_CLIENT_ID}")"

if [ -n "${NC_CLIENT_UUID}" ]; then
  set_client_secret "${NC_CLIENT_UUID}" "${KC_NEXTCLOUD_CLIENT_SECRET}" "${KC_NEXTCLOUD_CLIENT_ID}"
else
  echo "Missing Nextcloud client UUID" >&2
  exit 1
fi
if [ -n "${OP_CLIENT_UUID}" ]; then
  set_client_secret "${OP_CLIENT_UUID}" "${KC_OPENPROJECT_CLIENT_SECRET}" "${KC_OPENPROJECT_CLIENT_ID}"
else
  echo "Missing OpenProject client UUID" >&2
  exit 1
fi

# NC→OP needs api_v3 (aud=openproject); OP→NC Files tab needs add-nc-aud (aud=nextcloud).
echo "Ensuring client scopes api_v3 and add-nc-aud..."
APIV3_SCOPE_ID="$(ensure_client_scope "api_v3" "${KC_OPENPROJECT_CLIENT_ID}")"
NC_AUD_SCOPE_ID="$(ensure_client_scope "add-nc-aud" "${KC_NEXTCLOUD_CLIENT_ID}")"
add_default_scope_to_client "${NC_CLIENT_UUID}" "${APIV3_SCOPE_ID}" "${KC_NEXTCLOUD_CLIENT_ID}"
add_default_scope_to_client "${OP_CLIENT_UUID}" "${NC_AUD_SCOPE_ID}" "${KC_OPENPROJECT_CLIENT_ID}"

echo "Ensuring standard token exchange on Nextcloud and OpenProject clients..."
ensure_standard_token_exchange "${NC_CLIENT_UUID}" "${KC_NEXTCLOUD_CLIENT_ID}"
ensure_standard_token_exchange "${OP_CLIENT_UUID}" "${KC_OPENPROJECT_CLIENT_ID}"

echo "Keycloak realm setup complete."
# Readiness marker for the realm-setup probe (shared emptyDir /tmp with keycloak).
touch /tmp/realm-setup-complete
# Keep sidecar alive so the pod does not restart the setup container forever.
exec sleep infinity
