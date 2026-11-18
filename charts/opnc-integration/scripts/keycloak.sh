#!/bin/sh
# Realm bootstrap for the Keycloak sidecar (main container runs start against Postgres).
# Talks to Keycloak on localhost:8080 (shared pod network).
# Creates realm/users/clients if missing, then always resets passwords and client secrets
# from env so secret rotation works without wiping kc-postgresql.
# Invoked as /bin/sh (setup image); keep POSIX — no bash arrays.

set -eu

: "${KC_BOOTSTRAP_ADMIN_USERNAME:=${KEYCLOAK_ADMIN:-admin}}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:=${KEYCLOAK_ADMIN_PASSWORD:-admin}}"
# Local default 1234; PullPreview sets KC_REALM_USER_PASSWORD from GitHub secrets.
KC_REALM_USER_PASSWORD="${KC_REALM_USER_PASSWORD:-1234}"

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
        \"oauth2.device.authorization.grant.enabled\": \"true\"
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
        \"oauth2.device.authorization.grant.enabled\": \"true\"
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

if [ -n "${OP_CLIENT_UUID}" ] && [ -n "${NC_CLIENT_UUID}" ]; then
  echo "Enabling standard token exchange (OpenProject client)..."
  curl -sf -X PUT \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${OP_CLIENT_UUID}" \
    -H "${AUTH_H}" \
    -H "Content-Type: application/json" \
    -d "$(curl -sf \
      "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${OP_CLIENT_UUID}" \
      -H "${AUTH_H}" \
      | sed 's/"attributes":{/"attributes":{"standard.token.exchange.enabled":"true",/')" \
    || echo "Could not enable standard.token.exchange on OpenProject client"

  echo "Creating client policy for token exchange (Nextcloud → OpenProject)..."
  curl -sf -X PUT \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/client-policies/policies" \
    -H "${AUTH_H}" \
    -H "Content-Type: application/json" \
    -d "{
      \"policies\": [
        {
          \"name\": \"allow-nc-token-exchange\",
          \"description\": \"Allow Nextcloud client to exchange tokens for OpenProject\",
          \"enabled\": true,
          \"conditions\": [
            {
              \"condition\": \"client-access-type\",
              \"configuration\": { \"type\": [\"confidential\"] }
            }
          ],
          \"profiles\": [\"allow-nc-token-exchange\"]
        }
      ]
    }" || echo "Client policy may already exist or API differs"

  echo "Creating client profile for token exchange..."
  curl -sf -X PUT \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/client-policies/profiles?include-global-profiles=false" \
    -H "${AUTH_H}" \
    -H "Content-Type: application/json" \
    -d "{
      \"profiles\": [
        {
          \"name\": \"allow-nc-token-exchange\",
          \"description\": \"Allow token exchange for OpenProject\",
          \"executors\": [
            {
              \"executor\": \"use-lightweight-access-token\",
              \"configuration\": {}
            }
          ]
        }
      ]
    }" || echo "Client profile may already exist or API differs"
fi

echo "Keycloak realm setup complete."
# Keep sidecar alive so the pod does not restart the setup container forever.
exec sleep infinity
