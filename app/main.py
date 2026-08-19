import json
import logging
import os
import sys
import time
import traceback
from contextlib import asynccontextmanager
from typing import Any, Dict
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    import psycopg
except ImportError:  # degraded mode: app still starts, account endpoints 503
    psycopg = None

# Make planner importable (same package dir as this file)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planner  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE, "..", "data"))
CACHE_DIR = os.environ.get("CACHE_DIR", os.path.join(BASE, "..", "cache"))
STATIC_DIR = os.path.join(BASE, "static")

logger = logging.getLogger("travellerweb")

# ---------------------------------------------------------------------------
# Per-user games persistence (Postgres)
#
# ONE row per user: games(user_id TEXT PRIMARY KEY, data JSONB NOT NULL,
# updated_at TIMESTAMPTZ NOT NULL DEFAULT now()). `data` holds the ENTIRE
# games map (game-name -> game object), byte-compatible with
# localStorage['travellerweb.games'].
#
# The db_* functions below are the ONLY code that touches Postgres. Endpoints
# call them by module-level name at request time so tests can monkeypatch them
# without a real database. The map is serialized with json.dumps and read back
# with json.loads so it round-trips exactly.
# ---------------------------------------------------------------------------

CREATE_GAMES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS games (
    user_id     TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""


def _db_url() -> str:
    return os.environ.get("DATABASE_URL", "")


def _db_connect():
    if psycopg is None:
        raise RuntimeError("psycopg is not installed")
    url = _db_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg.connect(url)


def db_get_games(uid: str) -> Dict[str, Any]:
    """Return the user's full games map ({} if the user has no row yet)."""
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data::text FROM games WHERE user_id = %s", (uid,))
            row = cur.fetchone()
    if row is None:
        return {}
    return json.loads(row[0])


def db_put_games(uid: str, data_map: Dict[str, Any]) -> None:
    """Upsert the user's full games map (replaces whatever was stored)."""
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO games (user_id, data, updated_at)
                VALUES (%s, %s::jsonb, now())
                ON CONFLICT (user_id)
                DO UPDATE SET data = EXCLUDED.data, updated_at = now()
                """,
                (uid, json.dumps(data_map)),
            )
        conn.commit()


def db_delete_game(uid: str, name: str) -> None:
    """Remove one game from the user's map (no-op if key or row absent)."""
    with _db_connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data::text FROM games WHERE user_id = %s", (uid,))
            row = cur.fetchone()
            if row is None:
                return
            data = json.loads(row[0])
            data.pop(name, None)
            cur.execute(
                "UPDATE games SET data = %s::jsonb, updated_at = now() WHERE user_id = %s",
                (json.dumps(data), uid),
            )
        conn.commit()


def ensure_games_table(max_attempts: int = 6, initial_delay: float = 1.0, max_delay: float = 5.0) -> bool:
    """Create the games table idempotently with retry/backoff (~5s cap).

    Never raises: logs a warning and returns False if the DB is unreachable so
    the app still starts; account endpoints will then return 503.
    """
    for attempt in range(1, max_attempts + 1):
        try:
            with _db_connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(CREATE_GAMES_TABLE_SQL)
                conn.commit()
            logger.info("games table ready")
            return True
        except Exception as exc:  # noqa: BLE001
            delay = min(initial_delay * (2 ** (attempt - 1)), max_delay)
            logger.warning(
                "games table not ready (attempt %d/%d): %s; retrying in %.1fs",
                attempt, max_attempts, exc, delay,
            )
            time.sleep(delay)
    logger.warning("games table could not be created: DB unreachable; running without persistence")
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    if _db_url():
        ensure_games_table()
    yield


app = FastAPI(title="travellerweb", version="1.0.0", lifespan=lifespan)


class PlanRequest(BaseModel):
    config: Dict[str, Any]


# ---------------------------------------------------------------------------
# Authentik identity (forward-auth headers injected by Traefik)
# ---------------------------------------------------------------------------

def identity_from_headers(request: Request) -> Dict[str, str] | None:
    """Return {uid, username, name, email} from the X-Authentik-* headers.

    Headers are matched case-insensitively (Starlette lowercases them). A
    missing/empty X-Authentik-Uid means the request is anonymous -> None.
    """
    uid = (request.headers.get("x-authentik-uid") or "").strip()
    if not uid:
        return None
    return {
        "uid": uid,
        "username": request.headers.get("x-authentik-username", ""),
        "name": request.headers.get("x-authentik-name", ""),
        "email": request.headers.get("x-authentik-email", ""),
    }


def require_identity(request: Request) -> Dict[str, str]:
    """Return the authenticated identity or raise 401."""
    ident = identity_from_headers(request)
    if ident is None:
        raise HTTPException(status_code=401, detail="not authenticated")
    return ident


# ---------------------------------------------------------------------------
# Account / games endpoints
# ---------------------------------------------------------------------------

@app.get("/api/me")
def api_me(request: Request):
    return require_identity(request)


@app.get("/api/games")
def api_games(request: Request):
    ident = require_identity(request)
    try:
        return db_get_games(ident["uid"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("db_get_games failed: %s", exc)
        raise HTTPException(status_code=503, detail="database unavailable")


@app.put("/api/games")
def api_put_games(request: Request, body: Dict[str, Any]):
    ident = require_identity(request)
    try:
        db_put_games(ident["uid"], body)
    except Exception as exc:  # noqa: BLE001
        logger.warning("db_put_games failed: %s", exc)
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"ok": True}


@app.delete("/api/games/{name}")
def api_delete_game(request: Request, name: str):
    ident = require_identity(request)
    try:
        db_delete_game(ident["uid"], unquote(name))
    except Exception as exc:  # noqa: BLE001
        logger.warning("db_delete_game failed: %s", exc)
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Existing endpoints (unchanged)
# ---------------------------------------------------------------------------

@app.post("/api/plan")
def api_plan(req: PlanRequest):
    cfg = dict(req.config)
    cfg.setdefault("data_dir", DATA_DIR)
    cfg.setdefault("cache_dir", CACHE_DIR)
    try:
        result = planner.plan(cfg)
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        raise HTTPException(status_code=422, detail=str(exc))
    return result


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/sectors")
def api_sectors():
    try:
        sectors = planner.list_sectors(CACHE_DIR)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Unable to load sectors: {exc}")
    return {"sectors": sectors}


@app.get("/api/systems")
def api_systems(sector: str):
    try:
        systems = planner.list_systems(sector, CACHE_DIR)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Unable to load systems for '{sector}': {exc}")
    return {"sector": sector, "systems": systems}


@app.get("/api/search")
def api_search(q: str = ""):
    try:
        return planner.search(q)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Search failed: {exc}")


@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
