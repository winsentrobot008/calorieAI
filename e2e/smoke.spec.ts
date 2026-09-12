/**
 * CalorieAI 视觉冒烟测试（Midscene.ai + Playwright）
 *
 * 模型配置来自 .env.local（由 playwright.config.ts 注入 process.env）：
 *   OPENAI_BASE_URL / OPENAI_API_KEY → Gemini OpenAI 兼容端点
 *   MIDSCENE_MODEL_NAME              → gemini-3.7-flash
 *
 * 断言由 VLM 观察页面截图完成（而非 DOM 选择器），故称视觉 E2E。
 * 运行：npm run build && npx playwright test e2e/smoke.spec.ts
 */

import { test as base, type Fixtures } from "@playwright/test";
import {
  PlaywrightAiFixture,
  type PlayWrightAiFixtureType,
} from "@midscene/web/playwright";

// Midscene 的夹具定义把 use 回调标成 any，TS 无法从 PlaywrightAiFixture()
// 反推夹具值类型，因此显式声明本用例用到的两个夹具。
type VisualFixtures = Pick<PlayWrightAiFixtureType, "ai" | "aiAssert">;

// 夹具必须 extend 进 Playwright test（是 fixture 定义，无法从 page 解构）。
const test = base.extend<VisualFixtures>(
  PlaywrightAiFixture() as unknown as Fixtures<VisualFixtures>
);

test.describe("CalorieAI Visual Smoke Test", () => {
  test("Homepage elements render check", async ({ page, aiAssert }) => {
    // 相对路径，走 playwright.config.ts 的 baseURL（127.0.0.1:3100）。
    await page.goto("/");
    // 等待网络空闲，避免页面在视觉断言/交互期间被销毁（page destruction warning）。
    await page.waitForLoadState("networkidle");
    await aiAssert("Check if the main title or logo is visible on screen");
  });

  test("Interactive meal selection and input mode toggle", async ({ page, ai, aiAssert }) => {
    // 相对路径，走 playwright.config.ts 的 baseURL（127.0.0.1:3100）。
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 餐次选择：中文界面显示「午餐」，英文界面显示「Dinner」。
    await ai('Click on meal option "午餐" or "Dinner"');
    // 输入方式切换：中文界面显示「文字输入」，英文界面显示「Text Input」。
    await ai('Click on mode toggle "文字输入" or "Text Input"');
    // 视觉断言：文字模式下应出现食物描述输入框。
    await aiAssert('Check if the food text description input field is displayed on screen');
  });
});
