# travellerweb

A web UI for [traveller-trade-planner](https://github.com/elacy/traveller-trade-planner) — a
**Traveller RPG trade-route planner**. Instead of editing the Python `main()` to change the fleet
and route, enter every detail in the browser and get the most profitable (capital-growth-per-week)
route back.

The planner pulls live world data from the [Traveller Map API](https://travellermap.com/api) and
models:

- **Passengers** (high/middle/basic/low passage + life support)
- **Freight** lots (major/minor/incidental)
- **Speculative trade** (trade-code modifiers, law-level legality, broker skill, tons available)
- **Running costs** — crew salaries, life support, maintenance, fuel
- **Ship-owner profit cuts** — mortgage and Perfect Stranger / Stern Metal (75%) per ship; Drinax is a fleet-level cut of all group profit (user-specified %)

The cargo/freight fill is solved as a linear program (PuLP / CBC) per leg.

## Run locally

```bash
uv venv .venv && . .venv/bin/activate
uv pip install -r requirements.txt
cp -r data/ app/data 2>/dev/null || true   # data JSONs next to the app, or set DATA_DIR
DATA_DIR=./data CACHE_DIR=./cache uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000.

## Docker

```bash
docker build -t travellerweb .
docker run --rm -p 8000:8000 \
  -e DATA_DIR=/app/data -e CACHE_DIR=/app/cache \
  -v "$PWD/cache:/app/cache" travellerweb
```

A GitHub Actions workflow (`.github/workflows/build.yml`) builds the image on push and publishes it
to `ghcr.io/elacy/travellerweb`.

## Configuration

Everything the CLI hardcoded is a field on the form (or the raw JSON tab). The config shape sent to
`POST /api/plan`:

```jsonc
{
  "fleet": {
    "name": "Pirates of Drinax",
    "ships": [
      {
        "name": "Vhurg",
        "monthly_maint": 4513, "fuel_per_jump": 20, "max_jump": 2,
        "fuel_tank": 42, "cargo": 25, "cargo_fuel": 0,
        "berths": [{ "type": "standard", "number": 8 }],
        "crew": [{ "name": "Carla Sagan", "salary": 0, "passage": "middle" }],
        "contract": { "type": "none | mortgage | perfect_stranger",
                      "mortgage": 0, "monthly_payment": null },
        "max_steward": 0, "max_broker": 3,
        "accepts_passengers": false, "banned_allegiances": ["Im"]
      }
    ],
    "fuel_dumps": [{ "sector": "Trojan Reach", "hex": "2117" }],
    "contract": { "type": "none | drinax", "percentage": 10 }
  },
  "start": { "sector": "Trojan Reach", "hex": "2221" },
  "start_date": { "year": 1105, "day": 262 },
  "stops": [{ "sector": "Trojan Reach", "hex": "2020" }],
  "avoid": [],
  "capital": 15800985,
  "uncut_profits": 0,
  "max_profit": null,
  "max_duration": null
}
```

See `default_config.json` for the exact fleet from the original `trade.py` (Pirates of Drinax campaign).

Legacy configs (top-level `ships`/`fuel_dumps`, ship-level `drinax` contracts) are still accepted:
ships and fuel dumps are read from the top level and any ship-level Drinax contract is lifted to the
fleet contract (10% default) rather than silently dropped.

## License

Same as the source project — see `traveller-trade-planner`.
