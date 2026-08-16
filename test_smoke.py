import sys, time, copy
sys.path.insert(0, "app")
import planner

S = {"standard": 0}  # placeholder

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
  "data_dir": "data",
  "cache_dir": "cache",
}

# Regression guard: passenger path. The preset ships all have accepts_passengers
# False, which historically hid two crashes in World.passengers (missing `date`
# arg; Fleet lacking max_steward). Flip one ship on and plan — must succeed.
cfg_pax = copy.deepcopy(config)
cfg_pax["fleet"]["ships"][0]["accepts_passengers"] = True
res_pax = planner.plan(cfg_pax)
print("passenger-enabled plan ok:", res_pax.get("ok"), "| profit:", res_pax.get("summary", {}).get("total_profit"))
assert res_pax.get("ok"), f"passenger path failed: {res_pax.get('error')}"

t0 = time.time()
res10 = planner.plan(config)
cfg20 = copy.deepcopy(config)
cfg20["fleet"]["contract"]["percentage"] = 20
res20 = planner.plan(cfg20)
print("elapsed", round(time.time() - t0, 1), "s")

for label, res in (("10%", res10), ("20%", res20)):
    print("\n=== drinax", label, "===")
    print("ok:", res.get("ok"))
    if res.get("ok"):
        print("summary:", res["summary"])
        md = res.get("markdown", "")
        print("markdown present:", bool(md), "(%d chars)" % len(md))
        print("--- markdown head ---")
        print("\n".join(md.splitlines()[:14]))
        for s in res["stops"]:
            print("\n==== STOP:", s["destination"], "| weeks", s["duration"], "| profit", s["real_profit"], "====")
    else:
        print("ERROR:", res.get("error"))

if res10.get("ok") and res20.get("ok"):
    p10 = res10["summary"]["total_profit"]
    p20 = res20["summary"]["total_profit"]
    print(f"\nSANITY: 10% profit={p10}, 20% profit={p20} -> higher cut => lower profit: {p20 < p10}")
    md = res10.get("markdown", "")
    print("table header present:", "| Date | Description | Amount | Notes |" in md)
    print("table separator present:", "| --- | --- | --- | --- |" in md)
