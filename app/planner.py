import json
import math
import statistics
import requests
import os.path
from pathlib import Path
import heapq
from bs4 import BeautifulSoup
import hashlib
from urllib.parse import urlparse, parse_qs
import pulp
import random
import re
import time

AVERAGE_D6 = 3.5

class bcolors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


class PassageType: 
    LOW = "low"
    BASIC = "basic"
    MIDDLE = "middle"
    HIGH = "high"

class BerthType:
    STANDARD = "standard"
    HIGH = "high"
    LOW = "low"

berth_to_passage = {
    BerthType.STANDARD: PassageType.MIDDLE,
    BerthType.HIGH: PassageType.HIGH,
    BerthType.LOW: PassageType.LOW,
}

class CrewMember:
    def __init__(self, name, salary, passage, life_support=-1) -> None:
        self.name = name
        self.salary = salary
        self.passage = passage
        self.life_support = life_support

class Passage:
    def __init__(self, type, number, steward) -> None:
        self.type = type
        self.number = number
        self.steward = steward


class Deal:
    def __init__(self, trade_good, purchase_price, sale_price, actual_sale_price, total_available_quantity) -> None:
        self.trade_good = trade_good
        self.purchase_price = purchase_price
        self.sale_price = sale_price
        self.actual_sale_price = actual_sale_price
        self.total_available_quantity = total_available_quantity


class Date:
    def __init__(self, year, day) -> None:
        self.year = year
        self.day = day
    
    def add_days(self, days):
        new_day = self.day + days
        new_year = self.year

        while new_day > 365:
            new_day -= 365
            new_year += 1
        
        return Date(new_year, new_day)
    
    def __str__(self) -> str:
        return f"{self.year}.{self.day}"


class TradeGood:
    def __init__(self, data, data_loader) -> None:
        self.name = data["name"]
        self.__availability = set(data["availability"]) if data["availability"] != "All" else None
        self.__tons_dice = data["tonsDice"]
        self.__tons_multiplier = data["tonsMultiplier"]
        self.__base_price = data["basePrice"]
        self.__purchase_modifier = data["purchaseModifier"]
        self.__sale_modifier = data["saleModifier"]
        self.__max_law_level = data["maxLawLevel"]
        self.data_loader = data_loader

    def tons_available(self, world, real, date):
        modifier = 0

        if world.population <= 3:
            modifier = -3
        elif world.population >= 9:
            modifier = 3

        dice_roll = world.roll_dice(f"tons-available-{self.name}", self.__tons_dice, real, date) + modifier

        return dice_roll * self.__tons_multiplier
    
    def is_available(self, world):
        if world.size is None:
            return False

        if self.__availability is None:
            return True
        
        trade_codes = set(world.remarks)

        if trade_codes.intersection(self.__availability):
            return True
        
        return False
    
    def is_illegal(self, world):
        if self.__max_law_level is None:
            return False
        
        return self.__max_law_level <= world.law
    
    def purchase_price(self, skill, world, real, date):
        return self.__best_price(world, skill, real, date, "purchase")

    
    def sale_price(self, skill, world, real, date):
        return self.__best_price(world, skill, real, date, "sale")
    

    def generate_rolls(self):
        rolls = []

        for a in range(1, 6+1): 
            for b in range(1, 6+1):
                for c in range(1, 6+1): 
                    rolls.append(a + b + c)
        return rolls

    def __best_price(self, world, skill, real, date, type):
        best_modifier = None
        modifiers = self.__purchase_modifier if type == "purchase" else self.__sale_modifier

        for remark in world.remarks:
            if remark in modifiers:
                modifier = modifiers[remark]

                if best_modifier is None or best_modifier < modifier:
                    best_modifier = modifier

        if best_modifier is None:
            best_modifier = 0

        skill -= 2 # remove the skill of who you are trading with

        if real:
            roll = best_modifier + skill + world.roll_dice(f"price-roll-{self.name}-{type}", 3, real, date)
            factor = self.data_loader.modified_price(roll, type)
            return factor * self.__base_price, 0
        else:
            prices = []
            for roll in self.generate_rolls():
                prices.append(self.data_loader.modified_price(best_modifier + skill + roll, type) * self.__base_price)

            return statistics.median(prices), statistics.stdev(prices)

class TradeResult:
    def __init__(self, reachable, has_trade, starting_capital, final_capital, actual_final_capital, deals, table):
        self.reachable = reachable
        self.has_trade = has_trade
        self.starting_capital = starting_capital
        self.final_capital = final_capital
        self.actual_final_capital = actual_final_capital
        self.deals = deals
        self.table = table


def hex_distance(x1, y1, x2, y2):
    # Traveller Map global hex grid uses "even-q" offset (even columns shifted
    # down) — verified empirically against the sector-local odd-q distances.
    # Using WorldX/WorldY lets us measure distance ACROSS sector boundaries.
    def to_cube(col, row):
        z = row - (col - (col & 1)) // 2
        return col, -col - z, z

    ax, ay, az = to_cube(x1, y1)
    bx, by, bz = to_cube(x2, y2)
    return max(abs(ax - bx), abs(ay - by), abs(az - bz))


class World:
    def __init__(self, data, data_loader) -> None:
        uwp = data["UWP"]
        self.starport = uwp[0]
        self.size = self.__parse_hex(uwp[1])
        self.atmosphere = self.__parse_hex(uwp[2])
        self.hydrographics = self.__parse_hex(uwp[3])
        self.population = self.__parse_hex(uwp[4])
        self.government = self.__parse_hex(uwp[5])
        self.law = self.__parse_hex(uwp[6])
        self.tech = self.__parse_hex(uwp[8])
        self.sector_hex = SectorHex(data["Sector"], data["Hex"])
        self.name = data["Name"]
        self.x = int(data["WorldX"])
        self.y = int(data["WorldY"])
        self.zone = data["Zone"]
        self.data_loader = data_loader
        self.__neighbours = None
        self.allegiance = data["Allegiance"]

        self.remarks = data["Remarks"].split()

    @staticmethod
    def __parse_hex(hex):
        if hex == "?":
            return None
        
        return int(hex, 18)

    def __eq__(self, other):
        return self.sector_hex == other.sector_hex
    
    def __hash__(self) -> int:
        return hash(self.sector_hex)
    
    def __str__(self) -> str:
        return self.sector_hex.__str__()
    
    def __repr__(self) -> str:
        return self.sector_hex.__repr__()

    def accepts_freight(self):
        return self.population is not None and self.population > 0
    
    def roll_dice(self, name, count, real, date):
        if not real:
            return count * AVERAGE_D6

        digest = hashlib.sha256((str(date) + name).encode("utf-8")).digest()
        seed = int.from_bytes(digest, byteorder="big")

        rng = random.Random(seed)
        return sum(rng.randint(1, 6) for _ in range(count))


    @property
    def neighbours(self):
        if self.__neighbours is None:
            self.data_loader.load_world_data(self.sector_hex, True)

        return self.__neighbours
    
    @neighbours.setter
    def neighbours(self, neighbours):
        self.__neighbours = neighbours

    def __passenger_count(self, level, ship, other_world, starting_world, date):
        distance = self.distance(other_world)

        modifier = ship.max_steward

        if distance > 1:
            modifier -= distance - 1

        if level == "high":
            modifier -= 4
        elif level == "low":
            modifier += 1

        if self.population <= 1:
            modifier -= 4
        elif self.population in [6,7]:
            modifier += 1
        elif self.population >= 8:
            modifier += 3
        
        match self.starport:
            case "A":
                modifier += 2
            case "B":
                modifier += 2
            case "E":
                modifier -= 1
            case "X":
                modifier -= 3

        match self.zone:
            case "R":
                modifier -= 4
            case "A":
                modifier += 1

        roll = modifier + self.roll_dice(f"passengers-count", 2, starting_world, date)

        cold_war = (
            (self.sector_hex in NEU_BAYERN and other_world.sector_hex in AMONDIAGE)
            or
            (self.sector_hex in AMONDIAGE and other_world.sector_hex in NEU_BAYERN)
        )

        if cold_war:
            modifier -= 2

        upper = self.data_loader.passenger_count(math.ceil(roll))
        lower = self.data_loader.passenger_count(math.floor(roll))

        return (upper + lower) /2

        
    def distance(self, other_world):
        return hex_distance(self.x, self.y, other_world.x, other_world.y)
    
    def passengers(self, other_world, ship, starting_world, date):
        distance = self.distance(other_world)
        passenger_revenue = 0
        passage_descriptions = []

        for passage in ship.passage():
            ticket_price = self.data_loader.passage(passage.type, distance)
            passengers = min(self.__passenger_count(passage.type, ship, other_world, starting_world), passage.number)
            life_support = self.data_loader.life_support(passage.type) * distance / 4
            passenger_revenue += passengers * (ticket_price - life_support)
            passage_descriptions.append(f"{passengers} {passage.type} at {ticket_price} with life support of {life_support}")

            if passage.type == "middle" and passengers < passage.number:
                passengers = min(self.__passenger_count("basic", ship, other_world, starting_world, date), (passage.number - passengers) * 2)
                ticket_price = self.data_loader.passage("basic", distance)
                passenger_revenue += passengers * ticket_price
                passage_descriptions.append(f"{passengers} basic at {ticket_price}")

        return passenger_revenue, f"Took on passengers: {", ".join(passage_descriptions)}"

    def freight_modifier(self):
        modifier = 0

        match self.starport:
            case "A":
                modifier += 2
            case "B":
                modifier += 2
            case "E":
                modifier -= 1
            case "X":
                modifier -= 3

        match self.zone:
            case "R":
                modifier -= 6
            case "A":
                modifier -= 2

        if self.tech <= 6:
            modifier -= 1

        if self.tech >= 9:
            modifier += 2
        
        return modifier

    def freight(self, other_world, ship, real, date):
        distance = self.distance(other_world)

        modifier = self.roll_dice(f"freight-modifier", 2, real, date) + ship.max_broker - 8
        modifier += self.freight_modifier()
        modifier += other_world.freight_modifier()
        modifier -= (distance -1)


        def lots(type_modifier, lot_multiplier):
            r = self.roll_dice(f"freight-lot-dice-{type_modifier}", 2, real, date) + modifier
            dice_count = self.data_loader.freight_table(r + type_modifier)

            lot_count = math.floor(self.roll_dice(f"freight-lot-count-{type_modifier}", dice_count, real, date))
            return [math.floor(lot_multiplier * self.roll_dice(f"freight-lot-{type_modifier}-{i}", 1, real, date)) for i in range(lot_count)]

        lots = lots(-4, 10) + lots(0, 5) + lots(2, 1)

        return [lot for lot in lots]

    def best_trades(self, other_world, trade_goods, ship, capital, starting_planet, cargo_distance, date):
        distance = self.distance(other_world)
        if cargo_distance is None:
            cargo_distance = distance
        cargo = ship.cargo_capacity(cargo_distance)
        freight_per_ton = self.data_loader.passage("freight", distance)

        if cargo is None:
            return TradeResult(reachable=False, has_trade=False, starting_capital=None, final_capital=None, actual_final_capital=None, deals=None)

        if not other_world.accepts_freight():
            return TradeResult(reachable=True, has_trade=False, starting_capital=capital, final_capital=capital, actual_final_capital=capital, deals=[f"No market at {other_world.name} (fuel-only stop)"])

        deals = []

        not_available = []
        unaffordable = []
        illegal = []

        problem = pulp.LpProblem("trade", pulp.LpMaximize)

        problem_variables = []
        total_tons = 0
        total_cost = 0
        total_profit = 0

        deals = {}

        for trade_good in trade_goods:
            if not trade_good.is_available(self):
                not_available.append(trade_good.name)
                continue

            if trade_good.is_illegal(self) or trade_good.is_illegal(other_world):
                illegal.append(trade_good.name)
                continue

            purchase_price, _ = trade_good.purchase_price(ship.max_broker, self, starting_planet, date)

            if purchase_price > capital:
                unaffordable.append(trade_good.name)
                continue

            sale_price, std_dev = trade_good.sale_price(ship.max_broker, other_world, False, date)
            actual_sale_price, _ = trade_good.sale_price(ship.max_broker, other_world, starting_planet, date)
            available_tons = trade_good.tons_available(self, starting_planet, date)

            if available_tons <= 0:
                continue

            x = pulp.LpVariable(trade_good.name, lowBound=0, upBound=available_tons, cat="Integer")

            total_tons += x
            total_cost += purchase_price * x
            total_profit += (sale_price - purchase_price) * x

            problem_variables.append(x)
            deals[x.name] = Deal(trade_good.name, purchase_price, sale_price, actual_sale_price, available_tons)

        freight_lots = self.freight(other_world, ship, starting_planet, date)

        freight_lookup = {}

        for i, size in enumerate(freight_lots):
            x = pulp.LpVariable(f"freight-{i}", lowBound=0, upBound=1, cat="Integer")
            freight_lookup[x.name] = size

            total_tons += x * size
            total_profit += freight_per_ton * size * x

            problem_variables.append(x)

        problem += total_profit
        problem += total_cost <= capital
        problem += total_tons <= cargo
        problem.solve(pulp.PULP_CBC_CMD(msg=0))

        
        starting_capital = capital
        final_capital = capital
        actual_final_capital = capital

        executed_deals = []
        deals_executed = False

        freight_tons = 0

        purchase_log = ""
        sell_log = ""

        for variable in problem_variables:
            if variable.value() < 0:
                raise Exception(f"Variable {variable.name} has negative value {variable.value()}")
            if not variable.value():
                continue

            if variable.name.startswith("freight"):
                freight_tons += freight_lookup[variable.name]
                continue

            deal = deals[variable.name]
            amount = variable.value()

            profit = amount * (deal.sale_price - deal.purchase_price)
            actual_profit = amount * (deal.actual_sale_price - deal.purchase_price)
            if amount != 0:
                executed_deals.append(f"Buy {amount}/{deal.total_available_quantity} of {deal.trade_good} at {deal.purchase_price}, sell at {deal.sale_price} (actual {deal.actual_sale_price}), total profit: {profit:,.2f}, capital: {final_capital:,.2f}->{final_capital + profit:,.2f}")
                purchase_log += f"| {date} | {amount}x {deal.trade_good} | -{round(deal.purchase_price*amount, 2)}  | |\n"
                sell_log += f"| {date.add_days(7)} | {amount}x {deal.trade_good} | {round(deal.actual_sale_price*amount, 2)}  | |\n"
                final_capital += profit
                actual_final_capital += actual_profit
                deals_executed = True
                capital -= amount * deal.purchase_price

        if freight_tons > 0:
             executed_deals.append(f"Take {freight_tons} tons of freight at {freight_per_ton} per ton, total profit: {freight_tons * freight_per_ton:,.2f}, capital: {final_capital:,.2f}->{final_capital + freight_tons * freight_per_ton:,.2f}")
             sell_log += f"| {date.add_days(7)} | {freight_tons}x Freight | {round(freight_per_ton*freight_tons, 2)}  | |\n"
             final_capital += freight_tons * freight_per_ton
             actual_final_capital += freight_tons * freight_per_ton

        executed_deals.append(f"Cash after goods are purchased is {capital:,.2f}")

        has_trade = deals_executed or freight_tons > 0
        return TradeResult(reachable=True, has_trade=has_trade, starting_capital=starting_capital, final_capital=final_capital, actual_final_capital=actual_final_capital, deals=executed_deals, table=f"{purchase_log}{sell_log}")

MORTGAGE_PAID = "mortgage_paid"

class Mortgage:
    def __init__(self, mortgage, monthly_payment=None):
        self.__mortgage = mortgage

        if monthly_payment is None:
            self.__monthly_payment = mortgage / 240
        else:
            self.__monthly_payment = monthly_payment

    def mortgage_payment(self, state):
        paid = state.get(MORTGAGE_PAID, 0)
        payment = self.__monthly_payment

        if self.__mortgage - paid < payment:
            payment = self.__mortgage - paid
        
        state[MORTGAGE_PAID] = paid + payment
        return payment
    
    def profit_cut(self, *argv):
        return None, None
    
    def monthly_income(self):
        return 0
    
    def current_cut(self, _):
        return 0
    
class FleetContract:
    def __init__(self, contracts):
        self.contracts = contracts

    def profit_cut(self, *args, **kwargs):
        cut = 0
        description = ""

        for contract in self.contracts:
             contract_cut, contract_description = contract.profit_cut(*args, **kwargs)

             if contract_cut is not None:
                cut += contract_cut
                description += contract_description + "; "

        return cut, description

    def monthly_income(self, *args, **kwargs):
        return sum(contract.monthly_income(*args, **kwargs) for contract in self.contracts)
    
    def current_cut(self, *args, **kwargs):
        return sum(contract.current_cut(*args, **kwargs) for contract in self.contracts)
    
    def mortgage_payment(self, *args, **kwargs):
        return sum(contract.mortgage_payment(*args, **kwargs) for contract in self.contracts)

class Fleet:
    def __init__(self, *ships: "Ship"):
        self.ships = ships
        self.contract = None

        contracts = [ship.contract for ship in ships if ship.contract is not None]
        if contracts:
            self.contract = FleetContract(contracts)
            
        self.max_broker = -1
        self.banned_allegiances = [allegiance for ship in ships if ship.banned_allegiances is not None for allegiance in ship.banned_allegiances]
        self.crew = [crew for ship in ships for crew in ship.crew]
        self.berths = [berth for ship in ships for berth in ship.berths]
        self.montly_maint = sum(ship.monthly_maint for ship in ships)

        for ship in ships:
            if ship.max_broker > self.max_broker:
                self.max_broker = ship.max_broker

    def running_cost(self, data_loader, months):
        return sum(ship.running_cost(data_loader, months) for ship in self.ships)

    def cargo_capacity(self, distance):
        return sum(ship.cargo_capacity(distance) for ship in self.ships)

    def max_jump(self):
        return min(ship.max_jump() for ship in self.ships)
    
    def jumps_required(self, distance):
        return max(ship.jumps_required(distance) for ship in self.ships)
    
    def expected_duration(self, distance):
        return max(ship.expected_duration(distance) for ship in self.ships)
    
    def fuel_cost(self, distance):
        return sum(ship.fuel_cost(distance) for ship in self.ships)
    
    def passage(self):
        passage = []

        for ship in self.ships:
            passage.extend(ship.passage())
        
        return passage

class Ship:
    def __init__(self, monthly_maint, fuel_per_jump, max_jump, fuel_tank, cargo, cargo_fuel, berths, crew, contract, max_steward, max_broker, accepts_passengers=True, banned_allegiances =[]) -> None:
        self.monthly_maint = monthly_maint
        self.__fuel_per_jump = fuel_per_jump
        self.__max_jump = max_jump
        self.__fuel_tank = fuel_tank
        self.__cargo = cargo
        self.__cargo_fuel = cargo_fuel
        self.contract = contract
        self.max_steward = max_steward
        self.max_broker = max_broker
        self.banned_allegiances = banned_allegiances
        self.accepts_passengers = accepts_passengers
        self.crew = crew
        self.berths = berths

    def running_cost(self, data_loader, months):
        cost = 0

        for member in self.crew:
            cost += member.salary * months
            cost += data_loader.life_support(member.passage) * months

        for berth in self.berths:
            if berth.type != BerthType.LOW:
                cost += 1000 * months

        cost += self.monthly_maint * months

        return math.ceil(cost)
    
    def passage(self):
        crew_passage = {}

        for member in self.crew:
            crew_passage[member.passage] = crew_passage.get(member.passage, 0) + 1

        passage = []
        
        for berth in self.berths:
            passage_type = berth_to_passage[berth.type]
            berth_number = berth.number

            if passage_type in crew_passage:
                if crew_passage[passage_type] <= berth_number:
                    berth_number -= crew_passage[passage_type]
                    del crew_passage[passage_type]
                    passage.append(Passage(berth_to_passage[berth.type], berth_number, self.max_steward))
                else:
                    crew_passage[passage_type] -= berth_number
                    continue
        if self.accepts_passengers:
            return passage
        
        return []

    def cargo_capacity(self, distance):
        fuel_required = distance * self.__fuel_per_jump
        fuel_required = max(fuel_required - self.__fuel_tank, 0)
        
        if self.__cargo_fuel < fuel_required:
            return None
        
        return self.__cargo + self.__cargo_fuel - fuel_required
    
    def max_jump(self):
        return math.floor((self.__cargo_fuel + self.__fuel_tank) / self.__fuel_per_jump)

    def jumps_required(self, distance):
        return math.ceil(distance / self.__max_jump)
    
    def expected_duration(self, distance):
        max_jump = self.max_jump()
        jumps = self.jumps_required(distance)
        return math.ceil(distance / max_jump) + jumps

    def fuel_cost(self, distance):
        # Assumes fuel is unprocessed
        return distance * self.__fuel_per_jump * 100
    
class SectorHex:
    def __init__(self, sector, hex) -> None:
        self.hex = hex
        self.sector = sector.lower()
        self.hex_x = int(hex[0:2])
        self.hex_y = int(hex[2:4])

    def __eq__(self, other):
        return self.hex == other.hex and self.sector == other.sector
    
    def __hash__(self) -> int:
        return hash(self.__str__())
    
    def __str__(self) -> str:
        return f"{self.sector}-{self.hex}"
    
    def __repr__(self) -> str:
        return self.__str__()

    def distance(self, other):
        if self.sector != other.sector:
            raise Exception(f"Unable to get distance between hexes in different sectors, {self} and {other}")

        def to_cube(col, row):
            z = row - (col + (col & 1)) // 2
            return col, -col - z, z

        ax, ay, az = to_cube(self.hex_x, self.hex_y)
        bx, by, bz = to_cube(other.hex_x, other.hex_y)
        return max(abs(ax - bx), abs(ay - by), abs(az - bz))

NEU_BAYERN = [SectorHex("Reft", "1822"), SectorHex("Reft", "1923")]
AMONDIAGE = [SectorHex("Reft", "2325"), SectorHex("Reft", "2225")]

def _get(url, attempts=3, timeout=30):
    last = None
    for i in range(attempts):
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


class DataLoader:
    def __init__(self, max_jump, data_dir="data", cache_dir="cache") -> None:
        self.__world_cache = dict()
        self.__max_jump = max_jump
        self.__fuel_dumps = []
        self.data_dir = data_dir
        self.cache_dir = cache_dir

        self.__trade_goods = None
        self.__passage_freight = None
        self.__passenger_count = None
        self.__freight_table = None
        self.__modified_price = None
        self.__life_support = None

    def add_fuel_dump(self, sector_hex):
        self.__fuel_dumps.append(sector_hex)

    def __sector_offset(self, sector):
        for cached in self.__world_cache.values():
            if cached.sector_hex.sector == sector and cached.x is not None:
                return cached.x - cached.sector_hex.hex_x, cached.y - cached.sector_hex.hex_y
        return None

    def __fuel_dump_world(self, sector_hex, sector_name):
        offset = self.__sector_offset(sector_hex.sector)
        if offset is None:
            return None
        offset_x, offset_y = offset
        return World({
            "UWP": "E000000-0",
            "Sector": sector_name,
            "Hex": sector_hex.hex,
            "Name": f"Fuel Dump {sector_hex.hex}",
            "WorldX": str(sector_hex.hex_x + offset_x),
            "WorldY": str(sector_hex.hex_y + offset_y),
            "Zone": "",
            "Allegiance": "",
            "Remarks": "",
        }, self)

    def __jump_worlds(self, sector, hex, max_jump):
        Path(self.cache_dir).mkdir(parents=True, exist_ok=True)
        file_name = os.path.join(self.cache_dir, f"{sector}-{hex}-{max_jump}.json")

        if os.path.isfile(file_name):
            with open(file_name, 'r') as file:
                return json.load(file)

        url = f'https://travellermap.com/api/jumpworlds?sector={requests.utils.quote(sector)}&hex={hex}&jump={max_jump}'
        jump_data = _get(url).json()

        with open(file_name, 'w') as f:
            json.dump(jump_data, f)

        return jump_data


    def load_world_data(self, sector_hex, force=False):
        if force or sector_hex not in self.__world_cache:
            jump_data = self.__jump_worlds(sector_hex.sector, sector_hex.hex, self.__max_jump)
            current_world = self.__world_cache.get(sector_hex)
            other_worlds = []

            for raw_world_data in jump_data["Worlds"]:
                world = World(raw_world_data, self)

                if world.sector_hex == sector_hex:
                    if current_world is None:
                        current_world = world
                        self.__world_cache[current_world.sector_hex] = current_world
                elif world.sector_hex in self.__world_cache:
                    other_worlds.append(self.__world_cache[world.sector_hex])
                else:
                    other_worlds.append(world)
                    self.__world_cache[world.sector_hex] = world

            for dump_hex in self.__fuel_dumps:
                if dump_hex == current_world.sector_hex:
                    continue
                if dump_hex.sector != current_world.sector_hex.sector:
                    continue
                if dump_hex.distance(current_world.sector_hex) > self.__max_jump:
                    continue

                if dump_hex in self.__world_cache:
                    other_worlds.append(self.__world_cache[dump_hex])
                else:
                    dump_world = self.__fuel_dump_world(dump_hex, jump_data["Worlds"][0]["Sector"])
                    if dump_world is not None:
                        other_worlds.append(dump_world)
                        self.__world_cache[dump_hex] = dump_world

            current_world.neighbours = other_worlds

        return self.__world_cache[sector_hex]
    
    def trade_goods(self):
        if self.__trade_goods is None:
            self.__trade_goods = []
            with open(os.path.join(self.data_dir, 'tradeGoods.json'), 'r') as file:
                tradeGoodsRaw = json.load(file)
                for tradeGoodRaw in tradeGoodsRaw:
                    self.__trade_goods.append(TradeGood(tradeGoodRaw, self))

        return self.__trade_goods
    
    def life_support(self, level):
        if self.__life_support is None:
            with open(os.path.join(self.data_dir, 'lifeSupport.json'), 'r') as file:
                self.__life_support = json.load(file)

        return self.__life_support[level]

    def passenger_count(self, roll):
        if roll < 1:
            roll = 1
        elif roll > 20:
            roll = 20

        if self.__passenger_count is None:
            with open(os.path.join(self.data_dir, 'passengerCount.json'), 'r') as file:
                self.__passenger_count = json.load(file)

        return self.__passenger_count[str(roll)] * AVERAGE_D6
    
    def freight_table(self, roll):
        if self.__freight_table is None:
            with open(os.path.join(self.data_dir, 'freightTable.json'), 'r') as file:
                self.__freight_table = json.load(file)

        matches = [entry["lots"] for entry in self.__freight_table if entry["roll"] <= roll]

        if matches:
            return max(matches)
        else:
            return 0


    def modified_price(self, roll, type):
        if roll < -3:
            roll = -3
        elif roll > 25:
            roll = 25

        if self.__modified_price is None:
            with open(os.path.join(self.data_dir, 'modifiedPrice.json'), 'r') as file:
                self.__modified_price = json.load(file)

        return self.__modified_price[str(roll)][type] / 100

    def passage(self, type, distance):
        if self.__passage_freight is None:
            with open(os.path.join(self.data_dir, 'passageFreight.json'), 'r') as file:
                self.__passage_freight = json.load(file)

        return self.__passage_freight[str(distance)][type]
    
class CompleteCondition:
    def __init__(self, destination=None, max_profit=None, max_duration=None) -> None:
        self.destination= destination
        self.max_profit = max_profit
        self.max_duration = max_duration

        if destination is None and max_profit is None and max_duration is None:
            raise Exception("Complete condition is not finished")

    def is_complete(self, world, total_duration, profit):
        if self.destination and self.destination.sector_hex == world.sector_hex:
            return True
        
        if self.max_profit is not None and profit >= self.max_profit:
            print(f"Yes Profit {profit} >= {self.max_profit} on {world.name}")
            return True
        
        if self.max_duration is not None and total_duration >= self.max_duration:
            return True
        
        return False

STARTING_NET_WORTH = "STARTING_NET_WORTH"

class Route:
    def __init__(self, starting_capital, starting_net_worth, worlds, avoid, complete_condition, ship, data_loader, start_duration, start_date, route_duration = 0, state=dict(),profit =0, text=[]) -> None:
        self.profit = profit
        self.starting_capital = starting_capital
        self.starting_net_worth = starting_net_worth
        self.complete_condition = complete_condition
        self.complete = complete_condition.is_complete(worlds[-1], route_duration, profit)
        self.state = state
        self.start_duration = start_duration
        self.worlds = worlds
        self.avoid = avoid
        self.text = text
        self.ship = ship
        self.start_date = start_date

        self.data_loader = data_loader
        self.route_duration = route_duration
        self.total_duration = route_duration + start_duration

    def generate_next_steps(self):
        if self.complete:
            return []

        current_world = self.worlds[-1]
        trade_goods = self.data_loader.trade_goods()
        starting_world = self.total_duration == 0

        for other_world in current_world.neighbours:
            if other_world.accepts_freight():
                yield from self.__try_step(current_world, [other_world], trade_goods, starting_world)
            else:
                for final_world in other_world.neighbours:
                    if final_world == current_world:
                        continue
                    if not final_world.accepts_freight():
                        continue
                    yield from self.__try_step(current_world, [other_world, final_world], trade_goods, starting_world)

    def __try_step(self, current_world, legs, trade_goods, starting_world):
        final_world = legs[-1]

        if self.complete_condition.destination and final_world in self.worlds:
            return
        if self.worlds[-10:].count(final_world) > 1:
            return
        if final_world in self.avoid:
            return
        if len(current_world.neighbours) > 2 and len(self.worlds) > 1 and self.worlds[-2] == final_world:
            return
        if final_world.zone == "R":
            return
        if final_world.size is None:
            return
        for allegiance in self.ship.banned_allegiances:
            if final_world.allegiance.startswith(allegiance):
                return

        for intermediate in legs[:-1]:
            if intermediate in self.avoid:
                return
            if intermediate.zone == "R":
                return

        prev = current_world
        leg_distances = []
        total_jumps = 0
        fuel_cost = 0
        for leg in legs:
            leg_dist = prev.distance(leg)
            if leg_dist > self.ship.max_jump():
                return
            leg_distances.append(leg_dist)
            total_jumps += self.ship.jumps_required(leg_dist)
            fuel_cost += self.ship.fuel_cost(leg_dist)
            prev = leg

        cargo_distance = max(leg_distances)
        total_distance = sum(leg_distances)

        text = []
        capital = self.starting_capital + self.profit
        arrival_date = self.start_date.add_days(total_jumps * 7)
        table = ""
        table += f"| {self.start_date} | Fuel | -{fuel_cost} |  |\n"
        text.append(f"Buy unrefined fuel for {fuel_cost}, capital {capital:,.2f}->{capital - fuel_cost:,.2f}")
        capital -= fuel_cost
        duration = total_jumps
        total_duration = self.total_duration + duration
        state = self.state.copy()

        running_costs = self.ship.running_cost(self.data_loader, total_jumps * (9/30))

        table += f"| {self.start_date} | Running Costs | -{round(running_costs, 2)} |  |\n"
        text.append(f"Running costs of {running_costs:,.2f}, capital: {capital:,.2f}->{capital-running_costs:,.2f}")
        capital -= running_costs

        if self.ship.contract:
            income = self.ship.contract.monthly_income()

            if income > 0:
                text.append(f"Monthly Income of {income:,.2f}, capital: {capital:,.2f}->{capital+income:,.2f}")
                capital += income

            mortgage_payment = self.ship.contract.mortgage_payment(state) * ((7* total_jumps) / 30)
            if mortgage_payment > 0:
                text.append(f"Mortgage paid of {mortgage_payment:,.2f}, capital: {capital:,.2f}->{capital-mortgage_payment:,.2f}")
                capital -= mortgage_payment
                table += f"| {self.start_date} | Mortgage | -{round(mortgage_payment, 2)} |  |\n"

        passenger_revenue, description = current_world.passengers(final_world, self.ship, starting_world, self.start_date)

        if passenger_revenue > 0:
            text.append(f"{description}, capital {capital:,.2f}->{passenger_revenue + capital:,.2f}")
            capital += passenger_revenue

        result = current_world.best_trades(final_world, trade_goods, self.ship, capital, starting_world, cargo_distance, self.start_date)

        if not result.reachable:
            return
        
        table += result.table

        text += result.deals
        final_capital = result.final_capital

        if self.ship.contract:
            cut, description = self.ship.contract.profit_cut(state, final_world, result.starting_capital, final_capital)

            if cut is not None:
                text.append(description)
                final_capital -= cut

            if starting_world:
                cut, _, = self.ship.contract.profit_cut(state, final_world, result.starting_capital, result.actual_final_capital)
            table += f"| {arrival_date} | Cut | -{round(cut, 2)} |  |\n"
        
        if final_capital < 0:
            return
        
        text += [table]

        new_net_worth = final_capital

        if self.ship.contract:
            new_net_worth -= self.ship.contract.current_cut(state)

        if len(legs) == 1:
            leg_label = f"{current_world.name} -> {final_world.name}"
        else:
            via = " -> ".join(l.name for l in legs[:-1])
            leg_label = f"{current_world.name} -> {via} -> {final_world.name}"

        text = self.text + [f"{bcolors.BOLD}{leg_label}{bcolors.ENDC} ({total_distance} hexes, {duration} weeks) {final_world.sector_hex} net worth {self.net_worth():,.2f} -> {new_net_worth:,.2f}"] + text

        yield Route(self.starting_capital, self.starting_net_worth, self.worlds.copy() + legs, self.avoid, self.complete_condition, self.ship, self.data_loader, self.start_duration, arrival_date, total_duration, state, final_capital - self.starting_capital, text)

    def projected_duration(self):
        if self.complete or not self.complete_condition.destination:
            return self.route_duration
        
        remaining_distance = self.worlds[-1].distance(self.complete_condition.destination)
        remaining_duration = self.ship.expected_duration(remaining_distance)
        return self.route_duration + remaining_duration

    def crow_flies(self):
        if self.complete or not self.complete_condition.destination:
            return self.route_duration

        return self.worlds[0].distance(self.complete_condition.destination)
    
    def net_worth(self):
        net_worth = self.profit + self.starting_capital

        if self.ship.contract:
            net_worth -= self.ship.contract.current_cut(self.state)

        return net_worth

    def real_profit(self):
        return self.net_worth() - self.starting_net_worth
    
    def profit_per_week(self):
        return self.real_profit() / self.route_duration

    def __lt__(self, other):
        if other is None:
            return True
        
        factor = self.projected_duration() / other.projected_duration()

        other_profit_normalised = other.profit_per_week() * (factor **2)
        return self.profit_per_week() > other_profit_normalised

    
    def __eq__(self, other):
        return False
        
def find_best_route(capital, net_worth, ship, data_loader, start, start_date, destination, start_duration,avoid, state):
    routes = [Route(capital, net_worth, [start], avoid, destination, ship, data_loader, start_duration, start_date, state=state)]
    heapq.heapify(routes)
    best_route = None
    completed_routes = 0

    while routes and completed_routes < 1:
        route = heapq.heappop(routes)

        for new_route in route.generate_next_steps():
            if new_route.complete:
                completed_routes += 1
                if new_route < best_route:
                    best_route = new_route
            else:
                heapq.heappush(routes,new_route)
                routes.append(new_route)

    return best_route

class Berth:
    def __init__(self, type, number) -> None:
        self.type = type
        self.number = number

UNCUT_PROFITS = "uncut_profits"

class PerfectStrangerContract:
    def mortgage_payment(self, *args):
        return 0
    
    def monthly_income(self):
        return 0
    
    def current_cut(self, state):
        return state.get(UNCUT_PROFITS, 0) * .75
    
    def profit_cut(self, state, world, starting_capital, final_capital):
        if final_capital < starting_capital:
            return 0, "No profits to cut"
        
        profit = final_capital - starting_capital
        uncut_profit = state.get(UNCUT_PROFITS, 0)

        if world.sector_hex in NEU_BAYERN:
            state[UNCUT_PROFITS] = profit + uncut_profit
            return 0, f"No Bank of Amondiage in {world.name} uncut profits rise from {uncut_profit} to {uncut_profit + profit:,.2f}"
            
        cut = (profit + uncut_profit) *.75
        
        if uncut_profit > 0:
            del state[UNCUT_PROFITS]
            return cut, f"Stern Metal takes 75% ({cut:,.2f}) of the of total profits {uncut_profit + profit:,.2f} since last world with a Bank of Amondiage, capital: {final_capital:,.2f} -> {final_capital - cut:,.2f}"
        else:
            return cut, f"Stern Metal takes 75% of the of total profits, capital: {final_capital:,.2f} -> {final_capital - cut:,.2f}"

class DrinaxContract:
    def mortgage_payment(self, *_, **__):
        return 0
    
    def monthly_income(self):
        return 0
    
    def current_cut(self, *_, **__):
        return 0
    
    def profit_cut(self, _, __, starting_capital, final_capital):
        if final_capital < starting_capital:
            return 0, "No profits to cut"
        
        profit = final_capital - starting_capital
        cut = profit * .1
        return cut, f"King of Drinax takes 10% of profits, capital: {final_capital:,.2f} -> {final_capital - cut:,.2f}"

def parse_text(text):
    try:
        return float(text.replace(",", "").replace("%", ""))
    except ValueError:
        return text
    
def to_camel_case(s):
    # Split the string by spaces
    words = s.split(' ')
    # If there's only one word, return it as is
    if len(words) == 1:
        return words[0].lower()
    # Convert the first word to lowercase and capitalize the subsequent words
    camel_case = words[0].lower() + ''.join(word.capitalize() for word in words[1:])
    return camel_case

def get_md5_hash(text):
    # Create an MD5 hash object
    md5_hash = hashlib.md5()
    # Update the hash object with the text (encoded to bytes)
    md5_hash.update(text.encode('utf-8'))
    # Return the hexadecimal representation of the hash
    return md5_hash.hexdigest()


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

def strip_ansi(s):
    return _ANSI_RE.sub("", s)

_BERTH_MAP = {"standard": BerthType.STANDARD, "high": BerthType.HIGH, "low": BerthType.LOW}
_PASSAGE_MAP = {"low": PassageType.LOW, "basic": PassageType.BASIC,
                "middle": PassageType.MIDDLE, "high": PassageType.HIGH}

def build_ship(cfg):
    contract = None
    ctype = (cfg.get("contract") or {}).get("type", "none")
    if ctype == "mortgage":
        contract = Mortgage(float(cfg["contract"].get("mortgage", 0)),
                            cfg["contract"].get("monthly_payment"))
    elif ctype == "drinax":
        contract = DrinaxContract()
    elif ctype == "perfect_stranger":
        contract = PerfectStrangerContract()

    berths = [Berth(_BERTH_MAP[b["type"]], int(b["number"])) for b in cfg.get("berths", [])]
    crew = [CrewMember(c["name"], float(c.get("salary", 0)),
                       _PASSAGE_MAP.get(c.get("passage", "middle"), PassageType.MIDDLE),
                       int(c.get("life_support", -1))) for c in cfg.get("crew", [])]

    return Ship(
        monthly_maint=float(cfg.get("monthly_maint", 0)),
        fuel_per_jump=float(cfg.get("fuel_per_jump", 0)),
        max_jump=int(cfg.get("max_jump", 1)),
        fuel_tank=float(cfg.get("fuel_tank", 0)),
        cargo=float(cfg.get("cargo", 0)),
        cargo_fuel=float(cfg.get("cargo_fuel", 0)),
        berths=berths,
        crew=crew,
        contract=contract,
        max_steward=int(cfg.get("max_steward", 0)),
        max_broker=int(cfg.get("max_broker", 0)),
        accepts_passengers=bool(cfg.get("accepts_passengers", True)),
        banned_allegiances=list(cfg.get("banned_allegiances", [])),
    )


def plan(config):
    ships = [build_ship(s) for s in config.get("ships", [])]
    if not ships:
        return {"ok": False, "error": "No ships configured."}

    fleet = Fleet(*ships)

    data_dir = config.get("data_dir", "data")
    cache_dir = config.get("cache_dir", "cache")
    data_loader = DataLoader(fleet.max_jump(), data_dir=data_dir, cache_dir=cache_dir)

    for fd in config.get("fuel_dumps", []):
        data_loader.add_fuel_dump(SectorHex(fd["sector"], fd["hex"]))

    start = data_loader.load_world_data(SectorHex(config["start"]["sector"], config["start"]["hex"]))
    start_date = Date(int(config["start_date"]["year"]), int(config["start_date"]["day"]))

    stops = [data_loader.load_world_data(SectorHex(s["sector"], s["hex"])) for s in config.get("stops", [])]
    avoid = [data_loader.load_world_data(SectorHex(a["sector"], a["hex"])) for a in config.get("avoid", [])]

    capital = float(config.get("capital", 0))
    uncut_profits = float(config.get("uncut_profits", 0))

    max_profit = config.get("max_profit")
    if max_profit in ("", None):
        max_profit = None
    else:
        max_profit = float(max_profit)

    max_duration = config.get("max_duration")
    if max_duration in ("", None):
        max_duration = None
    else:
        max_duration = int(max_duration)

    state = {UNCUT_PROFITS: uncut_profits}
    net_worth = capital
    if fleet.contract:
        net_worth -= fleet.contract.current_cut(state)

    raw_profit = 0.0
    profit = 0.0
    duration = 0
    percentage_increase = 0.0

    stop_results = []

    for stop in stops:
        best_route = find_best_route(capital + raw_profit, net_worth, fleet, data_loader,
                                     start, start_date, CompleteCondition(stop),
                                     duration, avoid, state)
        if best_route is None:
            return {"ok": False, "error": f"Unable to find a viable route to {stop.name}."}
        state = best_route.state
        stop_results.append({
            "destination": stop.name,
            "hex": str(stop.sector_hex),
            "text": [strip_ansi(line) for line in best_route.text],
            "duration": best_route.route_duration,
            "real_profit": round(best_route.real_profit(), 2),
            "profit": round(best_route.profit, 2),
        })
        duration += best_route.route_duration
        percentage_increase += (duration * best_route.real_profit()) / (net_worth + profit)
        profit += best_route.real_profit()
        raw_profit += best_route.profit
        start_date = start_date.add_days(best_route.route_duration * 7)
        start = stop

    if max_profit is not None or max_duration is not None:
        best_route = find_best_route(capital, net_worth, fleet, data_loader, start, start_date,
                                     CompleteCondition(max_profit=max_profit, max_duration=max_duration),
                                     duration, avoid, state)
        if best_route is None:
            return {"ok": False, "error": "Unable to find a viable route for the profit/duration condition."}
        duration = best_route.route_duration
        percentage_increase = (duration * best_route.real_profit()) / net_worth
        profit = best_route.real_profit()
        start_date = start_date.add_days(best_route.route_duration * 7)
        stop_results.append({
            "destination": "(profit/duration condition)",
            "hex": str(best_route.worlds[-1].sector_hex),
            "text": [strip_ansi(line) for line in best_route.text],
            "duration": best_route.route_duration,
            "real_profit": round(best_route.real_profit(), 2),
            "profit": round(best_route.profit, 2),
        })

    per_week = (profit / duration) if duration > 0 else 0.0

    return {
        "ok": True,
        "stops": stop_results,
        "summary": {
            "weeks": duration,
            "total_profit": round(profit, 2),
            "profit_per_week": round(per_week, 2),
            "percentage_increase": round(percentage_increase, 4),
        },
    }



# ---------------------------------------------------------------- sector & system data
SECTOR_LIST_URL = "https://travellermap.com/api/universe"
SECTOR_DATA_URL = "https://travellermap.com/api/sec?sector={}"

_UWP_RE = re.compile(r"[A-HX?][0-9A-Z?]{6}-[0-9A-Z?]")


def parse_sec_worlds(text):
    worlds = []
    for line in text.splitlines():
        line = line.rstrip("\r")
        if len(line) < 5 or not line[:4].isdigit():
            continue
        hex_ = line[0:4]
        rest = line[4:]
        m = _UWP_RE.search(rest)
        if m:
            name = rest[:m.start()].strip()
            uwp = m.group(0)
        else:
            name = rest.strip()
            uwp = ""
        worlds.append({"hex": hex_, "name": name, "uwp": uwp})
    return worlds


def list_sectors(cache_dir, ttl=86400):
    cache_file = os.path.join(cache_dir, "universe-sectors.json")
    if os.path.isfile(cache_file) and (time.time() - os.path.getmtime(cache_file)) < ttl:
        try:
            with open(cache_file, "r") as f:
                return json.load(f)
        except Exception:
            pass

    r = _get(SECTOR_LIST_URL)
    sectors = []
    for s in r.json().get("Sectors", []):
        if s.get("Milieu") == "M1105" and "OTU" in (s.get("Tags") or ""):
            names = s.get("Names") or []
            name = names[0]["Text"] if names else (s.get("Abbreviation") or "")
            sectors.append({"name": name, "abbreviation": s.get("Abbreviation", "")})

    seen = set()
    out = []
    for s in sectors:
        if s["name"] not in seen:
            seen.add(s["name"])
            out.append(s)
    out.sort(key=lambda x: x["name"].lower())

    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    with open(cache_file, "w") as f:
        json.dump(out, f)
    return out


def list_systems(sector, cache_dir):
    slug = re.sub(r"[^a-z0-9]+", "-", sector.lower()).strip("-") or "sector"
    cache_file = os.path.join(cache_dir, f"sector-{slug}.json")
    if os.path.isfile(cache_file):
        try:
            with open(cache_file, "r") as f:
                return json.load(f)
        except Exception:
            pass

    r = _get(SECTOR_DATA_URL.format(requests.utils.quote(sector)))
    worlds = parse_sec_worlds(r.text)
    worlds.sort(key=lambda w: w["hex"])

    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    with open(cache_file, "w") as f:
        json.dump(worlds, f)
    return worlds
