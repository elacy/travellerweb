#!/usr/bin/env python3
"""Self-deploy travellerweb to TrueNAS SCALE.

Reconciles the running TrueNAS 'travellerweb' compose app onto the newest
ghcr.io/elacy/travellerweb:main image. Used by the CI/CD pipeline (runs on a
self-hosted runner on the NAS after the build pushes :main) and usable
standalone.

TrueNAS SCALE specifics (see self-hosting/truenas-custom-apps skill):
  - app.update REQUIRES custom_compose_config (MCP wrapper drops it; use raw WS).
  - A same :main TAG never re-pulls -> pin the image to the new @sha256 digest.
  - WS responses carry 'error' on failures; job methods return job ids that
    must be polled via core.get_jobs.

Env:
  TRUENAS_API_KEY   TrueNAS API key (required)
  TRUENAS_URL       default wss://nas.lacy.ie:443/websocket
  APP_NAME          default travellerweb
  APP_IMAGE         default ghcr.io/elacy/travellerweb (:main resolved live)
  HOST_PORT         default 8090 (host) / 8000 (container)
  TRAVELLERWEB_PG_PASSWORD  Postgres password (dev default 'travellerweb_dev' if unset)
"""
import os, sys, json, asyncio, ssl, urllib.request

APP = os.environ.get("APP_NAME", "travellerweb")
IMAGE = os.environ.get("APP_IMAGE", "ghcr.io/elacy/travellerweb")
TAG = os.environ.get("APP_TAG", "main")
HOST_PORT = int(os.environ.get("HOST_PORT", "8090"))
WS_URL = os.environ.get("TRUENAS_URL", "wss://nas.lacy.ie:443/websocket")
KEY = os.environ.get("TRUENAS_API_KEY", "").strip()
PG_PASSWORD = os.environ.get("TRAVELLERWEB_PG_PASSWORD", "").strip()
if not PG_PASSWORD:
    PG_PASSWORD = "travellerweb_dev"
    print("WARNING: TRAVELLERWEB_PG_PASSWORD not set; using fixed dev default "
          f"'{PG_PASSWORD}'. Add TRAVELLERWEB_PG_PASSWORD to /opt/data/.env "
          "for a real password.", file=sys.stderr)

_REPO = IMAGE.replace("ghcr.io/", "", 1)  # elacy/travellerweb

# Opt-in shared secret the reverse proxy must present (see identity_from_headers
# in app/main.py): blocks forged auth headers from clients that reach the
# published host port directly instead of through Traefik.
AUTH_PROXY_SECRET = os.environ.get("AUTH_PROXY_SECRET", "").strip()

ctx = ssl.create_default_context()
ctx.check_hostname = False          # NAS uses a self-signed cert
ctx.verify_mode = ssl.CERT_NONE


def ghcr_current_digest():
    """Resolve the digest that the :TAG currently points to (fresh build)."""
    with urllib.request.urlopen(
            f"https://ghcr.io/token?scope=repository:{_REPO}:pull&service=ghcr.io",
            timeout=30) as r:
        tok = json.load(r)["token"]
    req = urllib.request.Request(
        f"https://ghcr.io/v2/{_REPO}/manifests/{TAG}", headers={
            "Authorization": f"Bearer {tok}",
            "Accept": "application/vnd.oci.image.index.v1+json, "
                      "application/vnd.docker.distribution.manifest.list.v2+json, "
                      "application/vnd.oci.image.manifest.v1+json, "
                      "application/vnd.docker.distribution.manifest.v2+json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.headers.get("Docker-Content-Digest") or ""


async def _conn(ws_headers=None):
    import websockets                      # under /opt/hermes/.venv or runner image
    ws = await websockets.connect(WS_URL, ssl=ctx, max_size=64*1024*1024)
    await ws.send(json.dumps({"msg": "connect", "version": "1", "support": ["1"]}))
    await ws.recv()
    await ws.send(json.dumps({"msg": "method", "method": "auth.login_with_api_key",
                              "params": [KEY], "id": "auth"}))
    r = json.loads(await ws.recv())
    if r.get("result") is not True:
        raise RuntimeError(f"auth failed: {r}")
    return ws


async def deployed_image():
    ws = await _conn()
    try:
        await ws.send(json.dumps({"msg": "method", "method": "app.get_instance",
                                  "params": [APP], "id": "g"}))
        r = json.loads(await ws.recv())
        if r.get("error"):
            raise RuntimeError(r["error"])
        inst = r.get("result") or {}
        # image is inside config/services/<service>.image
        cfg = inst.get("config") or {}
        img = ""
        for svc in (cfg.get("services") or {}).values():
            img = svc.get("image", "")
            if img:
                break
        return img
    finally:
        await ws.close()


async def update_image(new_digest):
    compose = {
        "services": {
            APP: {
                "image": f"{IMAGE}@{new_digest}",
                "environment": {
                    "TZ": "America/Los_Angeles",
                    "DATABASE_URL": (f"postgresql://traveller:{PG_PASSWORD}"
                                     "@postgres:5432/travellerweb"),
                    # only forwarded when configured; Traefik must add the same
                    # value as a custom request header on every proxied request
                    **({"AUTH_PROXY_SECRET": AUTH_PROXY_SECRET} if AUTH_PROXY_SECRET else {}),
                },
                "ports": [{"published": HOST_PORT, "target": 8000}],
                "restart": "unless-stopped",
                "depends_on": {"postgres": {"condition": "service_healthy"}},
            },
            "postgres": {
                "image": "postgres:16-alpine",
                "restart": "unless-stopped",
                "environment": {
                    "POSTGRES_USER": "traveller",
                    "POSTGRES_PASSWORD": PG_PASSWORD,
                    "POSTGRES_DB": "travellerweb",
                },
                "volumes": [{
                    "type": "bind",
                    "source": "/mnt/bulk/hermes/travellerweb/postgres",
                    "target": "/var/lib/postgresql/data",
                }],
                "healthcheck": {
                    "test": ["CMD-SHELL",
                             "pg_isready -U traveller -d travellerweb"],
                    "interval": "10s", "timeout": "5s", "retries": 10,
                    "start_period": "30s",
                },
            },
        }
    }
    ws = await _conn()
    try:
        await ws.send(json.dumps({"msg": "method", "method": "app.update",
                                  "params": [APP, {"custom_compose_config": compose}],
                                  "id": "u"}))
        r = json.loads(await ws.recv())
        if r.get("error"):
            raise RuntimeError(r["error"])
        job = r.get("result")
        for _ in range(90):
            await ws.send(json.dumps({"msg": "method", "method": "core.get_jobs",
                                      "params": [[["id", "=", job]]], "id": "j"}))
            rr = json.loads(await ws.recv())
            rows = rr.get("result") or []
            if rows:
                st = rows[0].get("state")
                if st == "SUCCESS":
                    return
                if st == "FAILED":
                    raise RuntimeError(f"app.update job failed: {rows[0].get('error')}")
            await asyncio.sleep(5)
        raise RuntimeError("app.update job timed out")
    finally:
        await ws.close()


def main():
    if not KEY:
        print("TRUENAS_API_KEY is required"); sys.exit(2)
    try:
        new = ghcr_current_digest()
        old = asyncio.run(deployed_image())
    except Exception as e:
        print(f"deploy check error: {e}"); sys.exit(1)
    print(f"ghcr :{TAG} digest  = {new}")
    print(f"deployed image      = {old}")
    if not new:
        print("could not resolve GHCR digest"); sys.exit(1)
    if old and new in old:
        print("already up to date"); sys.exit(0)
    asyncio.run(update_image(new))
    print("redeployed")


if __name__ == "__main__":
    main()