// @ts-check
const { test, expect } = require('@playwright/test');

// A canned /api/plan response exercising the whole economics pipeline:
// the "Take first step" button renders, ledger line items are posted per
// category, the game date advances by duration_days (7), the fleet moves to
// the destination, and capital reflects income minus expenses.
const PLAN_RESPONSE = {
  ok: true,
  markdown: '## Route\n\nTorpol -> Oghma',
  stops: [],
  summary: {},
  first_step: {
    from: { name: 'Torpol', sector: 'trojan reach', hex: '2221' },
    to: { name: 'Oghma', sector: 'trojan reach', hex: '2020' },
    jumps: 1,
    duration_days: 7,
    fuel_cost: 5000,
    running_cost: 2000,
    monthly_income: 100000,
    mortgage_payment: 30000,
    passenger_revenue: 15000,
    trade_profit: 549531.25,
    cut: 0,
  },
  steps: [],
};

// A saved game with a populated ledger: opening 100000 + one 50000 income tx.
const SEEDED_GAME = {
  name: 'Seeded Game',
  opening_balance: 100000,
  current_date: { year: 1105, day: 1 },
  transactions: [
    {
      id: 'seed1',
      day: 1,
      year: 1105,
      type: 'income',
      amount: 50000,
      category: 'Cargo sale',
      note: 'seed',
    },
  ],
  boughtItems: [],
  characters: [],
  fleets: [
    {
      name: 'Seeded Fleet',
      location: '',
      ships: [
        {
          name: 'Seed Ship',
          monthly_maint: 0,
          fuel_per_jump: 0,
          max_jump: 1,
          fuel_tank: 0,
          cargo: 0,
          cargo_fuel: 0,
          berths: [],
          crew: [],
          contract: { type: 'none' },
          max_steward: 0,
          max_broker: 0,
          accepts_passengers: true,
          banned_allegiances: [],
        },
      ],
      fuel_dumps: [],
      contract: { type: 'none' },
    },
  ],
};

// Register the /api/plan stub AFTER the generic /api/** stub from beforeEach
// (Playwright routes are last-registered-wins) and record every request body.
function stubPlan(page, planBodies) {
  return page.route('**/api/plan', (route) => {
    try {
      planBodies.push(route.request().postDataJSON());
    } catch (_) {
      /* body not JSON — ignore for this test */
    }
    return route.fulfill({ json: PLAN_RESPONSE });
  });
}

test.beforeEach(async ({ page }) => {
  // The app is a pure localStorage SPA backed by external APIs (Traveller Map).
  // Stub every /api call so tests run hermetically against the static server,
  // accept any confirm()/alert() the flows trigger, and give each test a clean,
  // independent localStorage (fresh Playwright context + explicit clear+reload).
  await page.route('**/api/**', (route) =>
    route.fulfill({ json: { results: [], systems: [], sector: '' } })
  );
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/static/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('route tab: current date defaults and tab-switch retention', async ({
  page,
}) => {
  const year = page.locator('input[data-path="game.current_date.year"]');
  const day = page.locator('input[data-path="game.current_date.day"]');

  // fresh load: default in-memory game starts at year 1105, day 1
  await expect(year).toHaveValue('1105');
  await expect(day).toHaveValue('1');

  // edit both fields
  await day.fill('20');
  await year.fill('1106');

  // switch away and back — values must survive (they bind to game state)
  await page.locator('.tabs .tab[data-tab="fleet"]').click();
  await page.locator('.tabs .tab[data-tab="route"]').click();
  await expect(year).toHaveValue('1106');
  await expect(day).toHaveValue('20');

  // and they really landed in the game state, not just the DOM
  const stateDate = await page.evaluate(() => ({
    year: state.game.current_date.year,
    day: state.game.current_date.day,
  }));
  expect(stateDate).toEqual({ year: 1106, day: 20 });
});

test('starting capital is read-only and mirrors the ledger', async ({
  page,
}) => {
  const capital = page.locator('#route-capital');

  // read-only by construction
  await expect(capital).toHaveAttribute('readonly', '');

  // seed a saved game with opening_balance 100000 + a 50000 income tx,
  // then load it through the route-tab game dropdown (the same path a
  // user would take). #route-capital = opening + income - expense.
  // NOTE: travellerweb.games is a map keyed by game name.
  await page.evaluate(
    (seed) =>
      localStorage.setItem(
        'travellerweb.games',
        JSON.stringify({ [seed.name]: seed })
      ),
    SEEDED_GAME
  );
  await page.reload();
  await page.locator('#route-game-select').selectOption('Seeded Game');

  await expect(capital).toHaveValue('150000');
});

test('take first step: advances date, moves fleet, posts ledger lines', async ({
  page,
}) => {
  // plan stub AFTER the generic /api/** stub (last-registered wins)
  const planBodies = [];
  await stubPlan(page, planBodies);

  await page.locator('#plan-btn').click();

  // the first-step CTA appears, named after the destination
  const firstStep = page.locator('#route-take-first-step');
  await expect(firstStep).toBeVisible();
  await expect(firstStep).toHaveText('Take first step → Oghma');

  await firstStep.click();

  // date advanced by duration_days (7): day 1 + 7 = 8, same year
  await expect(
    page.locator('input[data-path="game.current_date.year"]')
  ).toHaveValue('1105');
  await expect(
    page.locator('input[data-path="game.current_date.day"]')
  ).toHaveValue('8');

  // fleet relocated to the destination
  await page.locator('.tabs .tab[data-tab="fleet"]').click();
  await expect(page.locator('#fleet-location')).toHaveValue('Oghma');

  // ledger got one line item per non-zero category, and no Contract Cut (cut=0)
  await page.locator('.tabs .tab[data-tab="txs"]').click();
  const categories = (
    await page.locator('#tx-list tbody tr td:nth-child(3)').allTextContents()
  ).map((c) => c.trim());
  expect(categories).toEqual(
    expect.arrayContaining([
      'Fuel',
      'Running Costs',
      'Income',
      'Mortgage',
      'Passengers',
      'Trade',
    ])
  );
  expect(categories).not.toContain('Contract Cut');

  // capital = 0 opening + (100000 + 15000 + 549531.25) - (5000 + 2000 + 30000)
  await expect(page.locator('#route-capital')).toHaveValue('627531.25');

  // the step is consumed: the CTA is removed so a second click cannot post
  // the same ledger lines (and re-advance the date) twice
  await expect(page.locator('#route-take-first-step')).toHaveCount(0);
  await expect(
    page.locator('input[data-path="game.current_date.day"]')
  ).toHaveValue('8');
});

test('next plan departs from the new fleet location', async ({ page }) => {
  const planBodies = [];
  await stubPlan(page, planBodies);

  // first plan + take the step
  await page.locator('#plan-btn').click();
  await expect(page.locator('#route-take-first-step')).toBeVisible();
  await page.locator('#route-take-first-step').click();

  // plan again — the fleet now starts from Oghma, not the original start
  await page.locator('#plan-btn').click();

  await expect
    .poll(() => planBodies.length)
    .toBe(2);

  // first call used the default start (Torpol / 2221)
  expect(planBodies[0].config.start).toEqual({
    sector: 'Trojan Reach',
    hex: '2221',
  });

  // second call departs from the fleet's new location (Oghma / 2020)
  expect(planBodies[1].config.start).toEqual({
    sector: 'trojan reach',
    hex: '2020',
  });

  // the fleet location field agrees
  await page.locator('.tabs .tab[data-tab="fleet"]').click();
  await expect(page.locator('#fleet-location')).toHaveValue('Oghma');
});
