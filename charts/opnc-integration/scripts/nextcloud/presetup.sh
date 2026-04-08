#!/bin/bash

set -eo

OLD_IFS=$IFS

# trim leading and trailing whitespaces
ENABLE_APPS=$(echo "$NEXTCLOUD_ENABLE_APPS" | xargs)
BUILD_GIT_APPS=""

function build_app_from_git() {
    for app in $ENABLE_APPS; do
        IFS="@" read -r app_name app_version <<<"$app"

        if [[ "$app_version" =~ "git="* ]]; then
            BUILD_GIT_APPS="$BUILD_GIT_APPS $app"
        fi
    done

    BUILD_GIT_APPS=$(echo "$BUILD_GIT_APPS" | xargs)
    if [[ -n "$BUILD_GIT_APPS" ]]; then
        return 0
    fi

    return 1
}

# exit early if no nextcloud branch
# and no apps are specified to build from git
if ! build_app_from_git && [[ -z "$NC_GIT_SOURCE_BRANCH" ]]; then
    exit 0
fi

SRC_DIR=/usr/src/nc
# skip source build if the directory already exists and is not empty
if [[ -n $(ls -A "$SRC_DIR") ]]; then
    echo "[INFO] '$SRC_DIR' exists and is not empty. Skipping source build..."
    exit 0
fi

# install php
apt-get update > /dev/null && apt-get install -y php-cli > /dev/null
# install composer
curl -sSL https://getcomposer.org/download/2.8.10/composer.phar -o /usr/bin/composer
chmod +x /usr/bin/composer

mkdir -p $SRC_DIR

####################################################
# clone nextcloud branch and build it if specified #
####################################################
if [[ -n "$NC_GIT_SOURCE_BRANCH" ]]; then
    set -x
    echo "[INFO] Cloning Nextcloud from branch: $NC_GIT_SOURCE_BRANCH"
    # get nextcloud server
    git clone --single-branch -b "${NC_GIT_SOURCE_BRANCH}" --depth 1 https://github.com/nextcloud/server.git $SRC_DIR
    cd "$SRC_DIR"
    git config -f .gitmodules submodule.3rdparty.shallow true
    git submodule update --init
    mkdir -p custom_apps
    mkdir -p data
    # Add activity app. Required for integration_openproject app
    git clone --single-branch -b "${NC_GIT_SOURCE_BRANCH}" --depth 1 https://github.com/nextcloud/activity.git $SRC_DIR/apps/activity
    set +x
fi

####################################################
# build apps from git sources if specified         #
####################################################
for app in $BUILD_GIT_APPS; do
    IFS="@" read -r app_name app_version <<<"$app"

    if [[ "$app_version" =~ "git="* ]]; then
        APP_DIR="$SRC_DIR/custom_apps/$app_name"
        rm -rf "$APP_DIR" || true

        GIT_REPO_URL="https://github.com/nextcloud/$app_name"
        if [[ "$app_name" == "oidc" ]]; then
            GIT_REPO_URL="https://github.com/H2CK/$app_name"
        fi

        mkdir -p "$APP_DIR"
        # extract the branch name
        app_branch=${app_version#git=}
        echo "[INFO] Building app '$app_name' from '$app_branch' branch."

        set -x
        curl -sL "${GIT_REPO_URL}/archive/refs/heads/${app_branch}.tar.gz" | tar -xz -C "$APP_DIR" --strip-components=1

        cd "$APP_DIR"
        composer install --no-dev
        npm ci && npm run build

        set +x
        cd "$SRC_DIR"
    fi
done

IFS=$OLD_IFS
