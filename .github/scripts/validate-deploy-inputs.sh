#!/usr/bin/env bash
# Validate and resolve deploy image tags / git branches before PullPreview.
# Env in: IN_OP_VER, IN_NC_VER, IN_KC_VER, IN_XWIKI_VER, IN_IO_VER, IN_XWIKI_EXT,
#         IN_OP_BRANCH, IN_NC_BRANCH, IN_IO_BRANCH
# Writes effective pins to GITHUB_OUTPUT and a per-product GITHUB_STEP_SUMMARY.
#
# resolve_playwright is a separate prior job because GHA binds container.image from
# needs.*.outputs before running_tests starts. Product pins here do not need per-product
# jobs — one batched gate is enough for fail-before-Hetzner visibility.
set -euo pipefail

image_tag_re='^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
version_token_re='^[A-Za-z0-9][A-Za-z0-9_.+~-]{0,127}$'

validate_image_tag() {
  local input_name="$1"
  local value="$2"

  [[ -z "${value}" ]] && return 0
  if [[ ! "${value}" =~ ${image_tag_re} ]]; then
    echo "::error::Invalid ${input_name}. Use a Docker tag-safe value."
    exit 1
  fi
}

validate_branch() {
  local input_name="$1"
  local value="$2"

  [[ -z "${value}" ]] && return 0
  if [[ "${value}" == -* ]] || [[ "${value}" =~ [[:space:][:cntrl:]] ]]; then
    echo "::error::Invalid ${input_name}. Branch names must not start with '-' or contain whitespace/control characters."
    exit 1
  fi
  if ! git check-ref-format --branch "${value}" >/dev/null 2>&1; then
    echo "::error::Invalid ${input_name}. Use a valid Git branch name."
    exit 1
  fi
}

validate_version_token() {
  local input_name="$1"
  local value="$2"

  [[ -z "${value}" ]] && return 0
  if [[ ! "${value}" =~ ${version_token_re} ]]; then
    echo "::error::Invalid ${input_name}. Use a simple release/version token."
    exit 1
  fi
}

validate_image_tag "openproject_version" "${IN_OP_VER:-}"
validate_image_tag "nextcloud_version" "${IN_NC_VER:-}"
validate_image_tag "keycloak_version" "${IN_KC_VER:-}"
validate_image_tag "xwiki_version" "${IN_XWIKI_VER:-}"
validate_version_token "integration_openproject_version" "${IN_IO_VER:-}"
validate_version_token "xwiki_extension_openproject_version" "${IN_XWIKI_EXT:-}"
validate_branch "openproject_branch" "${IN_OP_BRANCH:-}"
validate_branch "nextcloud_branch" "${IN_NC_BRANCH:-}"
validate_branch "integration_openproject_branch" "${IN_IO_BRANCH:-}"

check_branch_exists() {
  local input_name="$1"
  local repo_url="$2"
  local value="$3"

  [[ -z "${value}" ]] && return 0
  if ! git ls-remote --exit-code --heads "${repo_url}" "refs/heads/${value}" >/dev/null 2>&1; then
    local near_misses
    near_misses=$(git ls-remote --heads "${repo_url}" "*${value}*" 2>/dev/null | awk '{print $2}' | sed 's|refs/heads/||' | head -5 | tr '\n' ' ')
    if [[ -n "${near_misses}" ]]; then
      echo "::error::${input_name} '${value}' was not found. Did you mean one of: ${near_misses}?"
    else
      echo "::error::${input_name} '${value}' was not found in the expected upstream repository."
    fi
    exit 1
  fi
}

check_image_exists() {
  local input_name="$1"
  local image_ref="$2"

  if ! docker manifest inspect "${image_ref}" >/dev/null 2>&1; then
    echo "::error::${input_name} image tag was not found or is not accessible."
    exit 1
  fi
}

branch_exists() {
  local repo_url="$1"
  local value="$2"

  git ls-remote --exit-code --heads "${repo_url}" "refs/heads/${value}" >/dev/null 2>&1
}

integration_openproject_release_exists() {
  local version="${1#v}"
  local app_name="integration_openproject"
  local repo_url="https://github.com/nextcloud/${app_name}"

  curl -fsIL -o /dev/null "${repo_url}/releases/download/v${version}/${app_name}-v${version}.tar.gz" ||
    curl -fsIL -o /dev/null "${repo_url}/releases/download/v${version}/${app_name}-${version}.tar.gz" ||
    curl -fsIL -o /dev/null "${repo_url}/releases/download/${version}/${app_name}-${version}.tar.gz"
}

latest_integration_openproject_patch() {
  local minor="${1#v}"
  local escaped_minor="${minor//./\\.}"

  git ls-remote --tags --refs https://github.com/nextcloud/integration_openproject.git "refs/tags/v${minor}.*" 2>/dev/null |
    awk '{print $2}' |
    sed 's|refs/tags/v||' |
    grep -E "^${escaped_minor}\\.[0-9]+$" |
    sort -V |
    tail -1 || true
}

resolve_integration_openproject_source() {
  effective_io_ver="${IN_IO_VER:-}"
  effective_io_branch="${IN_IO_BRANCH:-}"

  if [[ -n "${effective_io_branch}" ]]; then
    effective_io_ver=""
    return 0
  fi

  [[ -n "${effective_io_ver}" ]] || return 0

  if integration_openproject_release_exists "${effective_io_ver}"; then
    effective_io_ver="${effective_io_ver#v}"
    return 0
  fi

  if [[ "${effective_io_ver#v}" =~ ^[0-9]+\.[0-9]+$ ]]; then
    local latest_patch
    latest_patch="$(latest_integration_openproject_patch "${effective_io_ver}")"
    if [[ -n "${latest_patch}" ]] && integration_openproject_release_exists "${latest_patch}"; then
      echo "::notice::integration_openproject_version '${effective_io_ver}' resolved to published release '${latest_patch}'."
      effective_io_ver="${latest_patch}"
      return 0
    fi

    local release_branch="release/${effective_io_ver#v}"
    if branch_exists "https://github.com/nextcloud/integration_openproject.git" "${release_branch}"; then
      echo "::notice::integration_openproject_version '${effective_io_ver}' is not a published release; using branch '${release_branch}'."
      effective_io_ver=""
      effective_io_branch="${release_branch}"
      return 0
    fi
  fi

  echo "::error::integration_openproject_version '${IN_IO_VER}' was not found as a downloadable release artifact. Use a full published version such as '3.1.0', or set integration_openproject_branch to an existing branch such as 'release/3.1'."
  exit 1
}

display_or_default() {
  local requested="$1"
  local effective="$2"
  if [[ -n "${requested}" ]]; then
    printf '%s' "${requested}"
  else
    printf '%s (default)' "${effective}"
  fi
}

effective_op_ver="${IN_OP_VER:-17}"
effective_nc_ver="${IN_NC_VER:-32}"
effective_kc_ver="${IN_KC_VER:-26.2.5}"
effective_xwiki_ver="${IN_XWIKI_VER:-18.4.1}"
effective_xwiki_ext="${IN_XWIKI_EXT:-1.2.0-rc-7}"

check_branch_exists "openproject_branch" "https://github.com/opf/openproject.git" "${IN_OP_BRANCH:-}"
check_branch_exists "nextcloud_branch" "https://github.com/nextcloud/server.git" "${IN_NC_BRANCH:-}"
check_branch_exists "integration_openproject_branch" "https://github.com/nextcloud/integration_openproject.git" "${IN_IO_BRANCH:-}"
check_image_exists "openproject_version" "docker.io/openproject/openproject:${effective_op_ver}"
check_image_exists "nextcloud_version" "docker.io/library/nextcloud:${effective_nc_ver}"
check_image_exists "keycloak_version" "docker.io/bitnamilegacy/keycloak:${effective_kc_ver}"
check_image_exists "xwiki_version" "docker.io/library/xwiki:${effective_xwiki_ver}"
resolve_integration_openproject_source

{
  echo "openproject_version=${effective_op_ver}"
  echo "openproject_branch=${IN_OP_BRANCH:-}"
  echo "nextcloud_version=${effective_nc_ver}"
  echo "nextcloud_branch=${IN_NC_BRANCH:-}"
  echo "keycloak_version=${effective_kc_ver}"
  echo "integration_openproject_version=${effective_io_ver}"
  echo "integration_openproject_branch=${effective_io_branch}"
  echo "effective_xwiki_version=${effective_xwiki_ver}"
  echo "effective_xwiki_extension_version=${effective_xwiki_ext}"
} >> "${GITHUB_OUTPUT}"

requested_io="${IN_IO_VER:-}"
[[ -n "${requested_io}" ]] || requested_io="(unset)"
resolved_io="${effective_io_ver:-}"
if [[ -n "${effective_io_branch}" ]]; then
  resolved_io="branch ${effective_io_branch}"
elif [[ -z "${resolved_io}" ]]; then
  resolved_io="(chart default)"
fi

op_requested="$(display_or_default "${IN_OP_VER:-}" "${effective_op_ver}")"
nc_requested="$(display_or_default "${IN_NC_VER:-}" "${effective_nc_ver}")"
kc_requested="$(display_or_default "${IN_KC_VER:-}" "${effective_kc_ver}")"
xw_requested="$(display_or_default "${IN_XWIKI_VER:-}" "${effective_xwiki_ver}")"
xw_ext_requested="$(display_or_default "${IN_XWIKI_EXT:-}" "${effective_xwiki_ext}")"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Deploy input resolution"
    echo ""
    echo "| Product | Requested | Resolved |"
    echo "|---|---|---|"
    echo "| OpenProject | \`${op_requested}\` | \`${effective_op_ver}\` |"
    if [[ -n "${IN_OP_BRANCH:-}" ]]; then
      echo "| OpenProject branch | \`${IN_OP_BRANCH}\` | \`${IN_OP_BRANCH}\` |"
    fi
    echo "| Nextcloud | \`${nc_requested}\` | \`${effective_nc_ver}\` |"
    if [[ -n "${IN_NC_BRANCH:-}" ]]; then
      echo "| Nextcloud branch | \`${IN_NC_BRANCH}\` | \`${IN_NC_BRANCH}\` |"
    fi
    echo "| Keycloak | \`${kc_requested}\` | \`${effective_kc_ver}\` |"
    echo "| integration_openproject | \`${requested_io}\` | \`${resolved_io}\` |"
    echo "| XWiki | \`${xw_requested}\` | \`${effective_xwiki_ver}\` |"
    echo "| XWiki OP extension | \`${xw_ext_requested}\` | \`${effective_xwiki_ext}\` |"
    echo ""
  } >> "${GITHUB_STEP_SUMMARY}"
fi
