#!/bin/bash
# Realm bootstrap for the Keycloak sidecar (main container runs start-dev).
# Talks to Keycloak on localhost:8080 (shared pod network).

set -euo pipefail

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
  echo "Failed to obtain admin token" >&2
  exit 1
fi

echo "Creating realm '${KC_REALM_NAME}'..."
curl -sf -X POST "${KEYCLOAK_URL}/admin/realms" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"realm\": \"${KC_REALM_NAME}\",
    \"enabled\": true,
    \"registrationEmailAsUsername\": true,
    \"loginWithEmailAllowed\": true,
    \"duplicateEmailsAllowed\": false,
    \"resetPasswordAllowed\": true,
    \"editUsernameAllowed\": true,
    \"bruteForceProtected\": true
}" || echo "Realm may already exist (continuing)"

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
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"alice\",
    \"firstName\": \"Alice\",
    \"lastName\": \"Hansen\",
    \"email\": \"alice@example.com\",
    ${COMMON_USER_ATTRIBUTES}
}" || echo "User alice may already exist"

curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/users" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"brian\",
    \"firstName\": \"Brian\",
    \"lastName\": \"Murphy\",
    \"email\": \"brian@example.com\",
    ${COMMON_USER_ATTRIBUTES}
}" || echo "User brian may already exist"

echo "Creating clients..."
curl -sf -X POST "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
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
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
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

# Token exchange for Nextcloud → OpenProject SSO (Keycloak 26+: client policies, not feature flag).
OP_CLIENT_UUID="$(
  curl -sf -G "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    --data-urlencode "clientId=${KC_OPENPROJECT_CLIENT_ID}" \
    | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1
)"
NC_CLIENT_UUID="$(
  curl -sf -G "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    --data-urlencode "clientId=${KC_NEXTCLOUD_CLIENT_ID}" \
    | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1
)"

if [ -n "${OP_CLIENT_UUID}" ] && [ -n "${NC_CLIENT_UUID}" ]; then
  echo "Enabling standard token exchange (OpenProject client)..."
  curl -sf -X PUT \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${OP_CLIENT_UUID}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$(curl -sf \
      "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/clients/${OP_CLIENT_UUID}" \
      -H "Authorization: Bearer ${ADMIN_TOKEN}" \
      | sed 's/"attributes":{/"attributes":{"standard.token.exchange.enabled":"true",/')" \
    || echo "Could not enable standard.token.exchange on OpenProject client"

  echo "Creating client policy for token exchange (Nextcloud → OpenProject)..."
  curl -sf -X PUT \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/client-policies/policies" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
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
              \"configuration\": { \"type\": \"confidential\" }
            }
          ],
          \"profiles\": [\"allow-nc-token-exchange\"]
        }
      ]
    }" || echo "Client policy may already exist or API differs"

  echo "Creating client profile for token exchange..."
  curl -sf -X PUT \
    "${KEYCLOAK_URL}/admin/realms/${KC_REALM_NAME}/client-policies/profiles?include-global-profiles=false" \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
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
else
  echo "Skipping token-exchange policy (missing client UUIDs)"
fi

echo "Keycloak realm setup complete."
# Keep sidecar alive so the pod does not restart the setup container forever.
exec sleep infinity
