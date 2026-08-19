// @ts-check
const { test, expect } = require('@playwright/test');

// Canonical order of the 7 tabs, as rendered by index.html
const TAB_ORDER = ['route', 'fleet', 'txs', 'buy', 'inv', 'chars', 'json'];

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

test('seven tabs render in the correct DOM order', async ({ page }) => {
  const tabs = page.locator('.tabs .tab');
  await expect(tabs).toHaveCount(7);
  expect(
    await tabs.evaluateAll((els) => els.map((el) => el.dataset.tab))
  ).toEqual(TAB_ORDER);
  // route is the default active tab
  await expect(page.locator('.tabs .tab.active')).toHaveAttribute(
    'data-tab',
    'route'
  );
});

test('clicking a tab shows its panel and hides the others', async ({
  page,
}) => {
  for (const name of TAB_ORDER) {
    const tab = page.locator(`.tabs .tab[data-tab="${name}"]`);
    await tab.click();
    await expect(tab).toHaveClass(/active/);
    for (const other of TAB_ORDER) {
      const panel = page.locator(`#tab-${other}`);
      if (other === name) {
        await expect(panel).toBeVisible();
      } else {
        await expect(panel).toBeHidden();
      }
    }
  }
});

test('buy flow posts a transaction and records inventory', async ({
  page,
}) => {
  // Opening the buy tab renders the catalogue fetched from /static/items.json
  // (the fix: absolute path so it resolves on every base URL).
  await page.locator('.tabs .tab[data-tab="buy"]').click();
  const items = page.locator('#buy-list .buy-item');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(0);

  const name = (
    await items.first().locator('.buy-item-head strong').textContent()
  ).trim();
  await items.first().click();
  await expect(items.first()).toHaveClass(/selected/);

  await page.locator('#buy-qty').fill('3');
  await page.locator('#buy-btn').click();

  // a transaction is posted to the ledger
  await page.locator('.tabs .tab[data-tab="txs"]').click();
  await expect(page.locator('#tx-list')).toContainText(`3 x ${name}`);

  // and the item shows up under Inventory with the bought quantity
  await page.locator('.tabs .tab[data-tab="inv"]').click();
  await expect(page.locator('#bought-list .bought-item').first()).toBeVisible();
  await expect(page.locator('#bought-list')).toContainText(name);
  await expect(page.locator('#bought-list')).toContainText('× 3');
});

test('characters: add, edit, delete', async ({ page }) => {
  await page.locator('.tabs .tab[data-tab="chars"]').click();
  await expect(page.locator('#char-list')).toContainText('No characters yet');

  // add
  await page.locator('#char-name').fill('Carla Sagan');
  await page.locator('#char-role').fill('Pilot');
  await page.locator('#char-career').fill('Scout');
  await page.locator('#char-salary').fill('2000');
  await page.locator('#char-save').click();

  const card = page.locator('#char-list .char-card').first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Carla Sagan');
  await expect(card).toContainText('Pilot · Scout');
  await expect(card).toContainText('Cr 2,000/month');

  // edit
  await card.locator('[data-action="edit-char"]').click();
  await expect(page.locator('#char-save')).toHaveText('Save changes');
  await page.locator('#char-name').fill('Carla Sagan II');
  await page.locator('#char-salary').fill('2500');
  await page.locator('#char-save').click();
  await expect(page.locator('#char-list .char-card')).toContainText(
    'Carla Sagan II'
  );
  await expect(page.locator('#char-list .char-card')).toContainText(
    'Cr 2,500/month'
  );
  await expect(page.locator('#char-save')).toHaveText('Add Character');

  // delete (the confirm() dialog is auto-accepted in beforeEach)
  await page
    .locator('#char-list .char-card [data-action="delete-char"]')
    .click();
  await expect(page.locator('#char-list')).toContainText('No characters yet');
});

test('fleet: add a fleet and assert it appears', async ({ page }) => {
  await page.locator('.tabs .tab[data-tab="fleet"]').click();

  // add a ship to the current fleet, then name and save it as a new fleet
  await page.locator('#add-ship').click();
  await page.locator('#fleet-name').fill('Scout Flotilla');
  await page.locator('#fleet-location').fill('Theev');
  await page.locator('#save-fleet').click();

  await expect(
    page.locator('#fleet-select option[value="Scout Flotilla"]')
  ).toHaveCount(1);
  await expect(page.locator('#route-fleet-status')).toContainText(
    'Scout Flotilla'
  );
});

test('persistence: saved game survives a reload', async ({ page }) => {
  // buy an item
  await page.locator('.tabs .tab[data-tab="buy"]').click();
  const items = page.locator('#buy-list .buy-item');
  await expect(items.first()).toBeVisible();
  const name = (
    await items.first().locator('.buy-item-head strong').textContent()
  ).trim();
  await items.first().click();
  await page.locator('#buy-qty').fill('2');
  await page.locator('#buy-btn').click();

  // add a character
  await page.locator('.tabs .tab[data-tab="chars"]').click();
  await page.locator('#char-name').fill('Persist Person');
  await page.locator('#char-role').fill('Navigator');
  await page.locator('#char-save').click();
  await expect(page.locator('#char-list .char-card')).toContainText(
    'Persist Person'
  );

  // name and save the game (persists to localStorage only on demand)
  await page.locator('.tabs .tab[data-tab="fleet"]').click();
  await page.locator('#game-name').fill('Persistence Test');
  await page.locator('#save-game').click();

  // reload and load the saved game back from the route-tab dropdown
  await page.reload();
  await page.locator('#route-game-select').selectOption('Persistence Test');

  await page.locator('.tabs .tab[data-tab="inv"]').click();
  await expect(page.locator('#bought-list .bought-item').first()).toBeVisible();
  await expect(page.locator('#bought-list')).toContainText(name);
  await expect(page.locator('#bought-list')).toContainText('× 2');

  await page.locator('.tabs .tab[data-tab="chars"]').click();
  await expect(page.locator('#char-list .char-card')).toContainText(
    'Persist Person'
  );
});
