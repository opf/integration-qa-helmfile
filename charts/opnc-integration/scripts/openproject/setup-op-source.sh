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
# database config
rm -f ./config/database.yml
cp ./config/database.production.yml ./config/database.yml

if [[ "$OP_USE_LOCAL_SOURCE" == "true" ]]; then
    sed -i 's/production:/development:/' ./config/database.yml
    export BUNDLE_APP_CONFIG=./.bundle
    export BUNDLE_WITHOUT=""
    bundle config set --local path './vendor/bundle'
    bundle config set --local with 'development test'
    bundle install
    npm install
    SECRET_KEY_BASE=1 RAILS_ENV=development DATABASE_URL=nulldb://db \
        bin/rails openproject:plugins:register_frontend assets:export_locales
else
    bash ./docker/prod/setup/bundle-install.sh
    # remove source map and production optimizations from build to speed up build time
    sed -i 's/ --configuration production --named-chunks --source-map//' ./frontend/package.json
    DOCKER=0 NG_CLI_ANALYTICS="false" bash ./docker/prod/setup/precompile-assets.sh
fi

if [[ -n "$OP_GIT_SOURCE_BRANCH" ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
    sed -i 's|rm -f ./config/database.yml||' ./docker/prod/setup/postinstall-common.sh
    rm -rf "$APP_PATH/tmp"
fi

chown "$APP_USER":"$APP_USER" -R "$APP_PATH"
# set sticky bit on app path and tmp directory
chmod +t "$APP_PATH"
chmod +t "/tmp"

touch "$APP_PATH/files/build-completed"
echo "[INFO] OpenProject build from source completed."