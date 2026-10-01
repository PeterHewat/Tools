import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:5171", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: "bun scripts/serve-test-site.ts",
    cwd: "..",
    url: "http://127.0.0.1:5171/Tools/",
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
