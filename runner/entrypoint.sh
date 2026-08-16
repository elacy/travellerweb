#!/usr/bin/env bash
# Self-hosted runner entrypoint for travellerweb.
#
# The stock ghcr.io/actions/actions-runner image is a *base* image (CMD
# /bin/bash) — it does not register itself. This entrypoint:
#   1. fetches a *fresh* GitHub registration token for the repo using the
#      repo-scope ACCESS_TOKEN (PAT), so restarts never hit a stale/expired
#      token (registration tokens are short-lived, ~1h);
#   2. configures the runner (or adopts an existing registration in
#      RUNNER_WORKDIR so a restart reuses it);
#   3. runs it.
#
# Expected env:
#   REPO_URL        e.g. https://github.com/elacy/travellerweb
#   ACCESS_TOKEN    PAT with repo scope (used to mint a fresh reg token)
#   RUNNER_NAME     e.g. travellerweb-nas
#   RUNNER_LABELS   comma list
#   RUNNER_WORKDIR  working dir for jobs (bind-mounted to persist)
#   RUNNER_GROUP    (optional)
set -euo pipefail

echo "== travellerweb runner entrypoint =="

# Derive owner/repo from REPO_URL.
# https://github.com/OWNER/REPO  ->  OWNER/REPO
repo_path="${REPO_URL#https://github.com/}"

echo "== fetch fresh registration token for ${repo_path} =="
# The GitHub API returns {"token": "...", "expires_at": ...}.
reg_json="$(curl -sS -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "https://api.github.com/repos/${repo_path}/actions/runners/registration-token")"

# shellcheck disable=SC2016
REG_TOKEN="$(printf '%s' "${reg_json}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')"
if [ -z "${REG_TOKEN}" ]; then
  echo "!! failed to obtain registration token: ${reg_json}" >&2
  exit 1
fi
echo "   -> token acquired"

cd /home/runner

# Ensure the workdir is owned by the runner uid (1654/app_uid).
WORKDIR="${RUNNER_WORKDIR:-/home/runner/work}"
mkdir -p "${WORKDIR}"
chown -R runner:runner "${WORKDIR}" 2>/dev/null || true

RUNNER_ALLOW_RUNASROOT=1 ./config.sh \
  --url "${REPO_URL}" \
  --token "${REG_TOKEN}" \
  --name "${RUNNER_NAME:-travellerweb-nas}" \
  --labels "${RUNNER_LABELS:-self-hosted,linux,travellerweb}" \
  ${RUNNER_GROUP:+--group} ${RUNNER_GROUP:-} \
  --work "${WORKDIR}" \
  --unattended \
  --replace \
  > /dev/null

exec ./run.sh