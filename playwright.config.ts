import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Uses a pre-installed Chromium when PW_CHROMIUM (or the sandbox default)
// points at one; otherwise Playwright's own browser (`npx playwright install chromium`).
const executablePath = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    launchOptions: executablePath ? { executablePath } : {},
    viewport: { width: 1440, height: 900 },
    locale: 'th-TH',
    timezoneId: 'America/New_York', // proves times do not depend on the viewer's zone
  },
});
