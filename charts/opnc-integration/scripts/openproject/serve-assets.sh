#!/bin/bash

set -eo pipefail

while [[ ! -f "$APP_PATH/files/build-completed" ]]; do
    echo "[INFO] Waiting build from source to complete..."
    sleep 10
done

npm run serve
