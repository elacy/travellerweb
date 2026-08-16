# Self-hosted GitHub Actions runner for travellerweb.
#
# The stock ghcr.io/actions/actions-runner image is a *base* image (CMD
# /bin/bash): it ships the runner binaries but does not register or run
# itself. This image adds an entrypoint (runner/entrypoint.sh) that fetches a
# fresh registration token from the repo PAT on every start and runs the
# runner, plus python3 + websockets so the deploy job can call the TrueNAS
# middleware. Run it as a service with:
#   - REPO_URL            https://github.com/elacy/travellerweb
#   - ACCESS_TOKEN        a PAT with repo scope (mints fresh reg token)
#   - RUNNER_NAME         e.g. travellerweb-nas
#   - RUNNER_LABELS       e.g. self-hosted,linux,travellerweb
#   - RUNNER_WORKDIR      bind-mounted dir to persist job config/artifacts
FROM ghcr.io/actions/actions-runner:latest

USER root

# python3 + websockets so scripts/deploy_travellerweb.py can drive the NAS.
# The actions-runner base ships python3 but no pip, so install python3-pip
# explicitly (otherwise `python3 -m pip` fails with "No module named pip").
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip curl jq \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --no-cache-dir --break-system-packages websockets

COPY runner/entrypoint.sh /usr/local/bin/travellerweb-runner-entry.sh
RUN chmod +x /usr/local/bin/travellerweb-runner-entry.sh

USER runner
ENTRYPOINT ["/usr/local/bin/travellerweb-runner-entry.sh"]