#!/bin/bash

set -eo pipefail

APP_PATH=/home/app/openproject

echo "[INFO] Building OpenProject from source..."

if [[ "$OP_USE_LOCAL_SOURCE" == "true" ]] && [[ -f "$APP_PATH/files/build-completed" ]]; then
    rm -f "$APP_PATH/files/build-completed"
fi

set -x

# install psql client
apt update > /dev/null && apt install -y postgresql-client > /dev/null
# install nodejs 22
curl -skL https://nodejs.org/dist/latest-v22.x/node-v22.22.2-linux-x64.tar.gz | tar -xz -C /usr/local --strip-components=1

mkdir -p "$APP_PATH" && cd "$APP_PATH"

if [[ -n $(find "$APP_PATH" -mindepth 1 -print -quit) ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
    echo "[ERROR] '$APP_PATH' is not empty. Please delete the volume and try again."
    exit 1
fi

if [[ -n "$OP_GIT_SOURCE_BRANCH" ]] && [[ "$OP_USE_LOCAL_SOURCE" != "true" ]]; then
    echo "[INFO] Cloning OpenProject from branch: $OP_GIT_SOURCE_BRANCH"
    git clone --branch "$OP_GIT_SOURCE_BRANCH" --depth 1 --single-branch "https://github.com/opf/openproject" "$APP_PATH"
fi

cp /scripts/database.yaml ./config/database.yml

bundle config set --local path './vendor/bundle'
bundle config set --local with 'development test'

# wait for database to be ready
timeout 300s bash -c "until psql $DATABASE_URL -c '\q'; do echo 'Waiting for database...'; sleep 2; done"

bin/setup_dev
bin/rails db:seed db:test:prepare

chown "$APP_USER":"$APP_USER" -R "$APP_PATH"
# set sticky bit on app path and tmp directory
chmod +t "$APP_PATH"
chmod +t "/tmp"

touch "$APP_PATH/files/build-completed"
echo "[INFO] OpenProject build from source completed."