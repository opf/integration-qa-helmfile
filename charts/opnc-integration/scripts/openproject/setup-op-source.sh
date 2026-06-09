#!/bin/bash

set -eo pipefail

APP_PATH=/home/app/openproject

if [[ "$OP_USE_LOCAL_SOURCE" == "true" ]]; then
    rm -f "$APP_PATH"/files/build-completed
    # clean up previous build artifacts
    rm -rf \
        "$APP_PATH"/node_modules \
        "$APP_PATH"/frontend/node_modules \
        "$APP_PATH"/config/frontend_assets.manifest.json \
        "$APP_PATH"/public/assets \
        "$APP_PATH"/.bundle \
        "$APP_PATH"/.cache \
        "$APP_PATH"/vendor/bundle \
        "$APP_PATH"/alias \
        "$APP_PATH"/versions
fi

PKG_TO_INSTALL=""
BUILD_DEPS="gcc make openssl"
for pkg in $BUILD_DEPS; do
    if ! which "$pkg" >/dev/null 2>&1; then
        PKG_TO_INSTALL="$PKG_TO_INSTALL $pkg"
    fi
done

if [[ -n "$PKG_TO_INSTALL" ]]; then
    echo "[INFO] Installing build dependencies: $PKG_TO_INSTALL"
    apt update >/dev/null
    apt install -y --no-install-recommends \
        ruby-dev \
        build-essential \
        libyaml-dev \
        libssl-dev \
        pkg-config >/dev/null
fi

echo "[INFO] Building OpenProject from source..."

mkdir -p "$APP_PATH" && cd "$APP_PATH"

if [[ -n "$OP_GIT_SOURCE_BRANCH" ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]] && [[ -z $(find "$APP_PATH" -mindepth 1 -print -quit) ]]; then
    echo "[INFO] Cloning OpenProject source branch."
    git clone --branch "$OP_GIT_SOURCE_BRANCH" --depth 1 --single-branch "https://github.com/opf/openproject" "$APP_PATH"
fi

cp /scripts/database.yaml ./config/database.yml

export SECRET_KEY_BASE=1
rails_with=""
setup_cmd="db:seed"
if [[ "$RAILS_ENV" != "production" ]]; then
    rails_with="development test"

    if [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
        setup_cmd="$setup_cmd assets:precompile"
    fi
else
    setup_cmd="$setup_cmd assets:precompile"
fi

bundle config set --local path "./vendor/bundle"
bundle config set --local with "$rails_with"

# wait for database to be ready
timeout 300s bash -c '
attempt=0
until psql "$DATABASE_URL" -c "\q" >/dev/null 2>&1; do
    if (( attempt % 15 == 0 )); then
        echo "Waiting for database..."
    fi
    attempt=$((attempt + 1))
    sleep 2
done
'

function create_database() {
    local db_name="$1"
    if ! psql "$DATABASE_URL" -lqt | cut -d \| -f 1 | grep -qw "$db_name"; then
        echo "[INFO] Creating database '$db_name'..."
        psql "$DATABASE_URL" -c "CREATE DATABASE $db_name"
    fi
}

function insert_database_url() {
    local section="$1"
    local url="$2"
    local tmp_file

    tmp_file="$(mktemp)"
    while IFS= read -r line; do
        printf '%s\n' "$line"
        if [[ "$line" == "${section}:" ]]; then
            printf '  url: %s\n' "$url"
        fi
    done < ./config/database.yml > "$tmp_file"
    mv "$tmp_file" ./config/database.yml
}

# create development and test databases if they don't exist
if [[ "$RAILS_ENV" != "production" ]]; then
    # create_database "openproject_dev"
    create_database "openproject_test"
    test_db_url="${DATABASE_URL%/*}/openproject_test"
    insert_database_url "development" "$DATABASE_URL"
    insert_database_url "test" "$test_db_url"
else
    insert_database_url "production" "$DATABASE_URL"
fi

bin/setup_dev
bin/rails db:migrate
bin/rails $setup_cmd

# Git-source deploys disable the image seeder job; seed env-driven data explicitly.
if bin/rails runner "exit(Setting.seed_enterprise_token.present? ? 0 : 1)"; then
    echo "[INFO] Seeding Enterprise token from environment..."
    bin/rails runner "EnvData::TokenSeeder.new({}).seed!"
fi

# OP 17.5+ persists OIDC login providers in auth_providers (EnvData::OpenIDConnect::ProviderSeeder).
if bin/rails runner "exit(Setting.seed_oidc_provider.present? ? 0 : 1)"; then
    echo "[INFO] Seeding OpenID Connect provider(s) from environment..."
    bin/rails runner "EnvData::OpenIDConnect::ProviderSeeder.new({}).seed!"
fi

if [[ "$RAILS_ENV" != "production" ]]; then
    RAILS_ENV="test" bin/rails db:migrate db:test:prepare
fi

chown "$APP_USER":"$APP_USER" -R "$APP_PATH"
# set sticky bit on app path and tmp directory
chmod +t "$APP_PATH"
chmod +t "/tmp"

touch "$APP_PATH/files/build-completed"
echo "[INFO] OpenProject build from source completed."
