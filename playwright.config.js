'use strict';

const { defineConfig, devices } = require('@playwright/test');

/* Test end-to-end sui flussi che si rompono davvero. Il server è quello di
 * e2e/server.js (niente dipendenze) e la rete esterna è bloccata nei test:
 * mappa, HelloBus e Nominatim non devono rendere instabile il risultato. */

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8124',
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'off'
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'telefono', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: 'node e2e/server.js',
    url: 'http://127.0.0.1:8124/',
    reuseExistingServer: true,
    timeout: 30000
  }
});
