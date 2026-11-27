import { defineConfig, devices } from '@playwright/test'

// Runs against `vite preview` of the existing builds (`npm run build` makes both): the customer
// site from dist/ and the staff console from dist-staff/. The specs stub the backend, so they never
// write to the real database.
// E2E_PORT moves both servers (public on it, staff on the next), e.g. when another checkout's
// previews hold the defaults; e2e/fake-staff.ts reads the same variable.
const PORT = Number(process.env.E2E_PORT ?? 4173)
const PUBLIC_URL = `http://127.0.0.1:${PORT}`
const STAFF_URL = `http://127.0.0.1:${PORT + 1}`
const STAFF_SPECS =
  /(staff-accounts|staff-enquiries|staff-estimates|staff-after-call|staff-quotes|staff-pilot|staff-compat|staff-outcomes|staff-redesign|staff-website|staff-stage-rules|staff-book-call|campaigns|checklist|staff-host|staff-pwa|ads|ads-review)\.spec\.ts/
const phone = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  webServer: [
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: PUBLIC_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run preview:staff -- --host 127.0.0.1 --port ${PORT + 1} --strictPort`,
      url: STAFF_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  use: {
    timezoneId: 'Europe/Dublin',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'public',
      testIgnore: STAFF_SPECS,
      use: { ...phone, baseURL: PUBLIC_URL },
    },
    {
      name: 'staff',
      testMatch: STAFF_SPECS,
      // The service worker would sit in front of the fake backend's routes; only staff-pwa.spec
      // turns it on.
      use: { ...phone, baseURL: STAFF_URL, serviceWorkers: 'block' },
    },
  ],
})
