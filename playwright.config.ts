import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** A subdirectory, as on GitHub Pages, so a root-relative URL would fail here first. */
const BASE = '/othello/';

/**
 * A machine with Chromium already installed somewhere Playwright does not
 * look (a CI image, a sandbox) can point at it instead of downloading one.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const chromium = chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {};

/**
 * Smoke tests against the production build, in all three engines plus the
 * two mobile layouts. This covers boot, layout and the game loop; audio,
 * real touch and performance still need real devices (see docs/release.md).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort --base ${BASE}`,
    url: `http://127.0.0.1:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...chromium } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], ...chromium } },
    { name: 'mobile-safari', use: { ...devices['iPhone 12'] } },
  ],
});
