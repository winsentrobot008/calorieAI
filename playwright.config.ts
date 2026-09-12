import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * 注入 .env.local：Playwright 不会读取 Next.js 的 env 文件，
 * 但 Midscene 需要从 process.env 拿到 OPENAI_API_KEY / MIDSCENE_MODEL_NAME。
 *
 * 注意：本机 User 级环境变量存在 OPENAI_API_KEY=ollama（本地 Ollama），
 * 若不覆盖就会静默顶掉 Gemini 配置，因此此处以 .env.local 为准。
 * 该文件已被 .gitignore 排除，CI 上不存在，故不会影响流水线注入。
 */
function loadLocalEnv(): void {
  // Playwright 把 TS 配置编译为 CJS（__dirname 可用）；原生 ESM 下退回 cwd。
  const configDir = typeof __dirname === "string" ? __dirname : process.cwd();
  const envPath = resolve(configDir, ".env.local");
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // .env.local 优先于继承来的环境变量（见上方说明）。
    process.env[key] = value;
  }
}

loadLocalEnv();

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
