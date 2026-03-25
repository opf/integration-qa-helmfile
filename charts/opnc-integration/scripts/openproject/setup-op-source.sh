#!/bin/bash

set -eo pipefail

APP_PATH=/home/app/openproject

echo "[INFO] Building OpenProject from source..."

set -x
mkdir -p "$APP_PATH" && cd "$APP_PATH"

if [[ "$OP_USE_LOCAL_SOURCE" == "true" ]]; then
    # clean up previous build artifacts
    rm -rf \
        "$APP_PATH"/node_modules \
        "$APP_PATH"/frontend/node_modules \
        "$APP_PATH"/config/frontend_assets.manifest.json \
        "$APP_PATH"/public/assets \
        "$APP_PATH"/files/build-completed \
        "$APP_PATH"/.bundle \
        "$APP_PATH"/.cache \
        "$APP_PATH"/vendor/bundle \
        "$APP_PATH"/alias \
        "$APP_PATH"/versions
fi

if [[ -n $(ls -A "$APP_PATH") ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
    echo "[ERROR] '$APP_PATH' is not empty. Please delete the volume and try again."
    exit 1
fi

if [[ -n "$OP_GIT_SOURCE_BRANCH" ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
    echo "[INFO] Cloning OpenProject from branch: $OP_GIT_SOURCE_BRANCH"
    git clone --branch "$OP_GIT_SOURCE_BRANCH" --depth 1 --single-branch "https://github.com/opf/openproject" "$APP_PATH"
fi

# trust git repos
git config --global safe.directory '*'

cp /scripts/database.yaml ./config/database.yml
bin/setup_dev
bin/rails db:seed db:migrate db:test:prepare
bin/rails openproject:plugins:register_frontend assets:export_locales

rm -rf "$APP_PATH/tmp"

chown "$APP_USER":"$APP_USER" -R "$APP_PATH"
# set sticky bit on app path and tmp directory
chmod +t "$APP_PATH"
chmod +t "/tmp"

touch "$APP_PATH/files/build-completed"
echo "[INFO] OpenProject build from source completed."