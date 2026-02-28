import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["api/**/*.spec.ts", "e2e/**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 60_000,

  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "api",
      testMatch: "api/**/*.spec.ts",
      use: {},
    },
    {
      name: "e2e-chromium",
      testMatch: "e2e/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "node proxy-server.js",
    url: "http://127.0.0.1:3001/health",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
