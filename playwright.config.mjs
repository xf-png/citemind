import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  globalTimeout: 180_000,
  reporter: [['list']],
  outputDir: 'qa/browser-results',
  use: {
    baseURL: process.env.CITEMIND_BASE_URL || 'http://127.0.0.1:4176',
    headless: true,
    launchOptions: process.platform === 'win32' ? { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-layout', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: process.env.CITEMIND_BASE_URL ? undefined : {
    command: 'python tools/serve.py --no-browser --port 4176 --quiet',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    stdout: 'ignore', stderr: 'ignore',
  },
});
