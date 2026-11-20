import { defineConfig, devices } from '@playwright/test'

// Runs against `vite preview` of an existing build (`npm run build` first). The e2e specs stub
// the Supabase RPC, so they never write to the real database.
const PREVIEW_URL = 'http://127.0.0.1:4173'

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: PREVIEW_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    baseURL: PREVIEW_URL,
    timezoneId: 'Europe/Dublin',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
})
