import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.YUNCMS_BROWSER_PORT ?? 34074);
const engines = (process.env.YUNCMS_BROWSER_ENGINES ?? 'chromium').split(',');
const profiles = { chromium: devices['Desktop Chrome'], firefox: devices['Desktop Firefox'], webkit: devices['Desktop Safari'] };
if (new Set(engines).size !== engines.length || engines.some(engine => !Object.hasOwn(profiles, engine))) throw Error('YUNCMS_BROWSER_ENGINES must list chromium, firefox or webkit without duplicates');
export default defineConfig({
  testDir: './test/browser', testMatch: '**/*.spec.js', fullyParallel: false, workers: 1, retries: 0,
  timeout: 30000, expect: { timeout: 8000 }, outputDir: '.yuncms/flows-tests/browser-results',
  reporter: [['list'], ['json', { outputFile: '.yuncms/flows-tests/browser-results.json' }]],
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: engines.map(name => ({ name, use: { ...profiles[name], viewport: { width: 1536, height: 1000 } } })),
  webServer: { command: 'node test/browser/fixtures/flows-server.mjs', url: `http://127.0.0.1:${port}/health`, reuseExistingServer: false, timeout: 30000, gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
});
