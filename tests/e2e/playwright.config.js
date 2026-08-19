// @ts-check
const path = require('path');
const { defineConfig } = require('@playwright/test');

// Serve the app/ directory itself so the app's absolute asset references
// (/static/app.js, /static/style.css, /static/items.json) resolve the same
// way they do under the FastAPI production server.
const appDir = path.resolve(__dirname, '..', '..', 'app');

module.exports = defineConfig({
  testDir: '.',
  fullyParallel: true,
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:8099',
  },
  webServer: {
    command: `python3 -m http.server 8099 --directory ${JSON.stringify(appDir)} >/dev/null 2>&1`,
    url: 'http://127.0.0.1:8099/static/index.html',
    reuseExistingServer: false,
    timeout: 15000,
    quiet: true,
  },
  reporter: [['list']],
});
