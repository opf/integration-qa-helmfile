#!/bin/bash

set -eo pipefail

APP_PATH=/home/app/openproject

PKG_TO_INSTALL=""
BUILD_DEPS="gcc make pkg-config openssl"
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

if [[ "$OP_USE_LOCAL_SOURCE" == "true" ]] && [[ -f "$APP_PATH/files/build-completed" ]]; then
    rm -f "$APP_PATH/files/build-completed"
fi

set -x

mkdir -p "$APP_PATH" && cd "$APP_PATH"

if [[ -n "$OP_GIT_SOURCE_BRANCH" ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]] && [[ -z $(find "$APP_PATH" -mindepth 1 -print -quit) ]]; then
    echo "[INFO] Cloning OpenProject from branch: $OP_GIT_SOURCE_BRANCH"
    git clone --branch "$OP_GIT_SOURCE_BRANCH" --depth 1 --single-branch "https://github.com/opf/openproject" "$APP_PATH"
fi

cp /scripts/database.yaml ./config/database.yml

export SECRET_KEY_BASE=1
rails_with=""
setup_cmd="db:seed"
if [[ "$RAILS_ENV" != "production" ]]; then
    rails_with="development test"
    setup_cmd="$setup_cmd db:test:prepare"

    if [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
        setup_cmd="$setup_cmd assets:precompile"
    fi
else
    setup_cmd="$setup_cmd assets:precompile"
fi

bundle config set --local path "./vendor/bundle"
bundle config set --local with "$rails_with"

# wait for database to be ready
timeout 300s bash -c "until psql $DATABASE_URL -c '\q'; do echo 'Waiting for database...'; sleep 2; done"

bin/setup_dev
bin/rails $setup_cmd

chown "$APP_USER":"$APP_USER" -R "$APP_PATH"
# set sticky bit on app path and tmp directory
chmod +t "$APP_PATH"
chmod +t "/tmp"

touch "$APP_PATH/files/build-completed"
echo "[INFO] OpenProject build from source completed."