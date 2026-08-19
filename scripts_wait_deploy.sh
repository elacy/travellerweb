#!/usr/bin/env bash
set -euo pipefail
cd /opt/data/tmp/travellerweb-work/travellerweb
export HOME=/opt/data/home
export PATH=/opt/data/home/.local/bin:$PATH
set -a; . /opt/data/.env; set +a

RUN=$(gh run list --repo elacy/travellerweb --json databaseId,headSha --jq '.[0] | .databaseId')
echo "latest run id: $RUN"
HEAD=$(git rev-parse --short HEAD)
echo "want build for $HEAD"

for i in $(seq 1 30); do
  J=$(gh run view "$RUN" --repo elacy/travellerweb --json headSha,jobs --jq '.[] // empty' 2>/dev/null)
  H=$(gh run view "$RUN" --repo elacy/travellerweb --json headSha --jq '.headSha' 2>/dev/null)
  if [ "$(echo "$H" | cut -c1-7)" != "$HEAD" ]; then
    # latest run isn't our commit yet (maybe stale listing); query by head
    RUN=$(gh run list --repo elacy/travellerweb --json databaseId,headSha --jq ".[] | select(.headSha | startswith(\"$HEAD\")) | .databaseId" | head -1)
  fi
  CONC=$(gh run view "$RUN" --repo elacy/travellerweb --json jobs --jq '.jobs[] | select(.name=="build-app") | .conclusion' 2>/dev/null)
  echo "poll $i: build-app conclusion=$CONC"
  if [ "$CONC" = "success" ]; then break; fi
  if [ "$CONC" = "failure" ]; then echo "BUILD FAILED"; exit 1; fi
  sleep 20
done

if [ "${CONC:-}" != "success" ]; then echo "timed out waiting for build"; exit 1; fi
echo "build-app succeeded; deploying..."
"${TW_DEPLOY_PYTHON:-/opt/hermes/.venv/bin/python}" scripts/deploy_travellerweb.py