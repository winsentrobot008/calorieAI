import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Cal AI 对标移动端 E2E：
 *  - iPhone 13 模拟（390x844 / touch / isMobile / deviceScaleFactor 3）；
 *  - 自动拉起本地 dev server（npm run dev -p 3100）。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    // 说明：本环境 Turbopack dev server 在 Playwright 中偶发水合异常，
    // 因此 E2E 使用生产构建（next start），行为与线上一致；
    // 构建由 npm run test:e2e（build && playwright test）先行完成，
    // webServer 只负责启动，避免 next build 并发锁问题。
    command: `npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium", // 仅安装 chromium，移动端模拟仍为 iPhone 13 视口/触摸
      },
    },
  ],
});
