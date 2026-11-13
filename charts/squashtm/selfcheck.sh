#!/usr/bin/env bash
# Assert squashtm chart renders hardened plain-Postgres manifests (and optional admin reset).
set -euo pipefail
cd "$(dirname "$0")/../.."
chart=charts/squashtm

out="$(helm template squashtm "${chart}")"
echo "${out}" | grep -q 'image: "postgres:17"'
echo "${out}" | grep -q 'readOnlyRootFilesystem: true'
echo "${out}" | grep -q 'key: jwt-secret'
! echo "${out}" | grep -q 'bitnami'
! echo "${out}" | grep -q 'app.kubernetes.io/instance'
! echo "${out}" | grep -q 'set-admin-password'

out_pw="$(helm template squashtm "${chart}" --set adminPassword='selfcheck-pass')"
echo "${out_pw}" | grep -q 'name: set-admin-password'
echo "${out_pw}" | grep -q 'name: hash-admin-password'
echo "${out_pw}" | grep -q 'admin-password: "selfcheck-pass"'

echo "[OK] charts/squashtm selfcheck"
