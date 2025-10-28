#!/bin/bash

set -eo pipefail

LOCAL_SRC_PATH=/home/app/localsrc
APP_PATH=/home/app/openproject

echo "[INFO] Building OpenProject from source..."

set -x
if [[ "$OP_USE_LOCAL_SOURCE" == "true" ]]; then
    cd "$APP_PATH"
    rm -rf node_modules frontend/node_modules config/frontend_assets.manifest.json public/assets files/build-completed .bundle
    cp -r "$APP_PATH" "$LOCAL_SRC_PATH"
    APP_PATH=$LOCAL_SRC_PATH
fi

if [[ -n $(ls -A "$APP_PATH") ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
    echo "[ERROR] '$APP_PATH' is not empty. Please delete the volume and try again."
    exit 1
fi

mkdir -p "$APP_PATH" && cd "$APP_PATH"
chown "$APP_USER":"$APP_USER" "$APP_PATH"

if [[ -n "$OP_GIT_SOURCE_BRANCH" ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
    echo "[INFO] Cloning OpenProject from branch: $OP_GIT_SOURCE_BRANCH"
    git clone --branch "$OP_GIT_SOURCE_BRANCH" --depth 1 --single-branch "https://github.com/opf/openproject" "$APP_PATH"
fi

# trust git repos
git config --global safe.directory '*'

if [[ "$OP_USE_LOCAL_SOURCE" == "true" ]]; then
    cp frontend/package.json frontend/package.json.bak
    export BUNDLE_APP_CONFIG=./.bundle
    export BUNDLE_WITHOUT=""
    bundle config set --local path './vendor/bundle'
    bundle config set --local with 'development test'
    bundle install
else
    bash ./docker/prod/setup/bundle-install.sh
fi

rm -f ./config/database.yml
cp ./config/database.production.yml ./config/database.yml

# remove source map and production optimizations from build to speed up build time
sed -i 's/ --configuration production --named-chunks --source-map//' ./frontend/package.json
DOCKER=0 NG_CLI_ANALYTICS="false" bash ./docker/prod/setup/precompile-assets.sh

if [[ -n "$OP_GIT_SOURCE_BRANCH" ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
    sed -i 's|rm -f ./config/database.yml||' ./docker/prod/setup/postinstall-common.sh
    rm -rf "$APP_PATH/tmp"
fi

# set sticky bit on app path and tmp directory
chmod +t "$APP_PATH"
chmod +t "/tmp"

if [[ "$OP_USE_LOCAL_SOURCE" == "true" ]]; then
    sed -i 's/production:/development:/' ./config/database.yml
    mv frontend/package.json.bak frontend/package.json
    cp -rfL "$APP_PATH"/* /home/app/openproject/
    cp -rf "$APP_PATH"/.bundle /home/app/openproject/
fi

touch "/home/app/openproject/files/build-completed"
echo "[INFO] OpenProject build from source completed."