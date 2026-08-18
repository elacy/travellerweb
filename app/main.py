import os
import sys
import traceback

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Any, Dict

# Make planner importable (same package dir as this file)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import planner  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE, "..", "data"))
CACHE_DIR = os.environ.get("CACHE_DIR", os.path.join(BASE, "..", "cache"))
STATIC_DIR = os.path.join(BASE, "static")

app = FastAPI(title="travellerweb", version="1.0.0")


class PlanRequest(BaseModel):
    config: Dict[str, Any]


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
