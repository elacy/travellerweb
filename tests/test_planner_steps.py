import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
import planner

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Self-contained offline Drinax config (same shape as test_smoke.py), with
# absolute data/cache paths so the test passes regardless of the CWD pytest
# is launched from.
config = {
  "fleet": {
    "name": "Pirates of Drinax",
    "ships": [
    {"name": "Vhurg", "monthly_maint": 4513, "fuel_per_jump": 20, "max_jump": 2, "fuel_tank": 42,
     "cargo": 25, "cargo_fuel": 0,
     "berths": [{"type": "standard", "number": 8}, {"type": "low", "number": 8}],
     "crew": [{"name": "Carla Sagan", "salary": 0, "passage": "middle"},
              {"name": "Talahasee of Tort", "salary": 0, "passage": "middle"},
              {"name": "Silent Unter", "salary": 2000, "passage": "middle"},
              {"name": "Jim Cheese", "salary": 6000, "passage": "middle"},
              {"name": "Old Jaek", "salary": 3000, "passage": "middle"}],
     "contract": {"type": "none"}, "max_steward": 0, "max_broker": 3,
     "accepts_passengers": False, "banned_allegiances": []},
    {"name": "Mercifuge", "monthly_maint": 8235, "fuel_per_jump": 40, "max_jump": 2, "fuel_tank": 82,
     "cargo": 199, "cargo_fuel": 0,
     "berths": [{"type": "standard", "number": 4}], "crew": [],
     "contract": {"type": "none"}, "max_steward": 0, "max_broker": 3,
     "accepts_passengers": False, "banned_allegiances": []},
    {"name": "Ambush Frigate", "monthly_maint": 27259, "fuel_per_jump": 40, "max_jump": 2, "fuel_tank": 120,
     "cargo": 101, "cargo_fuel": 0,
     "berths": [{"type": "high", "number": 1}, {"type": "standard", "number": 10}, {"type": "low", "number": 10}],
     "crew": [{"name": "Cassius Hart", "salary": 0, "passage": "middle"},
              {"name": "Hyacinth Argona", "salary": 0, "passage": "middle"},
              {"name": "Scarr", "salary": 2000, "passage": "middle"},
              {"name": "Gargoyle", "salary": 2000, "passage": "middle"},
              {"name": "Garginine", "salary": 2000, "passage": "middle"},
              {"name": "Brick", "salary": 2000, "passage": "middle"},
              {"name": "Duncan", "salary": 4000, "passage": "middle"}],
     "contract": {"type": "mortgage", "mortgage": 320013000, "monthly_payment": 1333387.5},
     "max_steward": 0, "max_broker": 3, "accepts_passengers": False, "banned_allegiances": []},
    {"name": "Far Trader A2", "monthly_maint": 4353, "fuel_per_jump": 20, "max_jump": 2, "fuel_tank": 40,
     "cargo": 65, "cargo_fuel": 0,
     "berths": [{"type": "standard", "number": 10}],
     "crew": [{"name": "Krrsh", "salary": 4000, "passage": "middle"},
              {"name": "penitent grim", "salary": 4000, "passage": "basic"},
              {"name": "Adro Vennisir", "salary": 4000, "passage": "basic"},
              {"name": "Streph Falter", "salary": 4000, "passage": "basic"},
              {"name": "Laert", "salary": 4000, "passage": "basic"},
              {"name": "Pete the Stench", "salary": 6000, "passage": "basic"},
              {"name": "Jimothey Deleroux", "salary": 2000, "passage": "middle"}],
     "contract": {"type": "none"}, "max_steward": 2, "max_broker": 3,
     "accepts_passengers": False, "banned_allegiances": []},
    {"name": "Far Trader A2 #2", "monthly_maint": 4353, "fuel_per_jump": 20, "max_jump": 2, "fuel_tank": 40,
     "cargo": 65, "cargo_fuel": 0,
     "berths": [{"type": "standard", "number": 10}],
     "crew": [{"name": "Amina Aseel", "salary": 0, "passage": "middle"},
              {"name": "Tom Vargface", "salary": 4000, "passage": "basic"},
              {"name": "Wolf Blood Axe", "salary": 2000, "passage": "middle"},
              {"name": "Opal Twice Vacced", "salary": 9000, "passage": "basic"},
              {"name": "kagni vasiir", "salary": 6000, "passage": "basic"},
              {"name": "Ramsey Grog", "salary": 4000, "passage": "basic"}],
     "contract": {"type": "none"}, "max_steward": 2, "max_broker": 3,
     "accepts_passengers": False, "banned_allegiances": []},
  ],
  "fuel_dumps": [{"sector": "Trojan Reach", "hex": "2117"}],
  "contract": {"type": "drinax", "percentage": 10},
  },
  "start": {"sector": "Trojan Reach", "hex": "2221"},
  "start_date": {"year": 1105, "day": 262},
  "stops": [{"sector": "Trojan Reach", "hex": "2020"}, {"sector": "Trojan Reach", "hex": "1919"}],
  "avoid": [],
  "capital": 15800985,
  "uncut_profits": 0,
  "max_profit": None,
  "max_duration": None,
  "data_dir": os.path.join(REPO_ROOT, "data"),
  "cache_dir": os.path.join(REPO_ROOT, "cache"),
}

STEP_KEYS = {
    "from", "to", "jumps", "duration_days", "fuel_cost", "running_cost",
    "monthly_income", "mortgage_payment", "passenger_revenue", "trade_profit",
    "cut",
}
WORLD_KEYS = {"name", "sector", "hex"}


def test_first_step_has_full_section_2a_shape():
    res = planner.plan(config)

    assert res.get("ok") is True
    # Existing fields unchanged in shape
    assert "stops" in res and isinstance(res["stops"], list) and len(res["stops"]) == 2
    assert "summary" in res and isinstance(res["summary"], dict)
    assert "markdown" in res and isinstance(res["markdown"], str) and res["markdown"]

    first_step = res.get("first_step")
    assert isinstance(first_step, dict), "first_step must be a dict when a route exists"
    assert STEP_KEYS <= set(first_step.keys()), (
        f"first_step missing section-2a keys: {STEP_KEYS - set(first_step.keys())}"
    )

    assert first_step["duration_days"] == first_step["jumps"] * 7
    assert isinstance(first_step["jumps"], int) and first_step["jumps"] >= 1
    assert isinstance(first_step["duration_days"], int)

    for world in (first_step["from"], first_step["to"]):
        assert isinstance(world, dict)
        assert WORLD_KEYS <= set(world.keys())
        assert world["name"] and world["sector"] and world["hex"]

    for money_key in ("fuel_cost", "running_cost", "monthly_income",
                      "mortgage_payment", "passenger_revenue", "trade_profit", "cut"):
        assert isinstance(first_step[money_key], float), f"{money_key} must be a float"
        assert first_step[money_key] >= 0.0

    # steps is the flattened ordered list; first_step == steps[0] when a route exists
    steps = res.get("steps")
    assert isinstance(steps, list) and steps, "steps must be non-empty when a route exists"
    assert first_step == steps[0]


def test_passenger_enabled_variant_plans_ok():
    cfg_pax = copy.deepcopy(config)
    cfg_pax["fleet"]["ships"][0]["accepts_passengers"] = True
    res = planner.plan(cfg_pax)
    assert res.get("ok") is True, f"passenger path failed: {res.get('error')}"
    assert isinstance(res.get("first_step"), dict)
    assert isinstance(res.get("steps"), list) and res["steps"]
