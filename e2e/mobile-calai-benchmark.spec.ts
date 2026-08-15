/**
 * Cal AI 对标移动端闭环 Benchmark（Cal AI = Ground Truth）
 *
 * Viewport：iPhone 390x844 —— 由 playwright.config.ts 的 devices["iPhone 13"] 提供
 * （touch + isMobile + deviceScaleFactor 3，browserName=chromium）。
 *
 * 用例矩阵（对齐 docs/AI_FACTORY_SPEC.md SOP-04 §4.2 Cal AI 主路线）：
 *   极简 Onboarding → 拍照 AI 拆解 → 今日进度条 → 免费 2 次后 Stripe 订阅
 *
 *   [M1] 按钮触达 ≥48px：核心交互按钮 boundingBox().height ≥ 48
 *   [M2] 全英文 Stripe 路由：免费 2 次后第 3 次拍照 → 跳转 checkout.stripe.com + <html lang="en">
 *   [M3] Cal AI 核心链路：极简 Onboarding → 拍照 AI 拆解 → Save to Log → 今日进度条数值增加
 *
 * 测试桩说明（TEST-STUB，红线约束见 SOP-04 §4.4 禁令一）：
 *   analyze-image / stripe-subscribe 仅在 E2E 脚本内显式拦截，以支撑确定性断言；
 *   生产链路从不回退 Mock（A→B→C 真实回退链，见 MEMORY.md 决策 7），
 *   Stripe 未配密钥仅返回演示降级提示（mock:true），不会静默伪造成真实支付。
 */

import { test, expect, type Page } from "@playwright/test";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// ── TEST-STUB：与真实 analyze-image 路由返回结构一致（结构化拆解：名称/克数/PFC/卡路里）──
const MOCK_SCAN = {
  records: [
    {
      food: "鸡胸肉",
      food_en: "Chicken Breast",
      grams: 150,
      calories: 247,
      protein_g: 46,
      fat_g: 5.3,
      carbs_g: 0,
      confidence: 0.92,
    },
    {
      food: "西兰花",
      food_en: "Broccoli",
      grams: 100,
      calories: 34,
      protein_g: 2.8,
      fat_g: 0.4,
      carbs_g: 7,
      confidence: 0.95,
    },
  ],
  count: 2,
  model: { provider: "e2e-mock", model: "benchmark", label: "E2E Benchmark Mock" },
};

const EXPECTED_KCAL = 281; // 247 + 34

// ── TEST-STUB：确定性 Stripe Checkout URL（生产由 /api/stripe/subscribe 真实创建）──
// 未配 STRIPE_SECRET_KEY 时后端返回 mock:true 不跳转，故在此拦截以稳定验证「前端 Paywall → Stripe 路由」。
const STRIPE_CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_benchmark?locale=en";

/**
 * 干净状态引导：清空历史餐食/画像/扫描计数 + 固定英文 UI（en）。
 * 登录后为新账号（未 onboarded）→ Onboarding 自动弹出，走真实 3 步设置。
 */
async function bootstrap(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("calorieai_locale", "en");
  });
}

/** Google 1 秒登录（OAuth 路由返回确定性 mock 用户，Header 显示 google_user） */
async function loginWithGoogle(page: Page) {
  await page.locator("button.btn-login").click();
  await page.locator(".auth-social-btn", { hasText: "Google" }).click();
  await expect(page.locator(".login-modal")).toBeHidden({ timeout: 15000 });
  await expect(page.locator("button.btn-login")).toContainText("google_user", { timeout: 10000 });
}

/** 极简 Onboarding 3 步：性别 → 体重/目标/身高/年龄 → 每日卡路里目标（推荐微调） */
async function completeOnboarding(page: Page) {
  await expect(page.locator(".onboarding-overlay")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".onboarding-card")).toContainText("Set Up Your Goals");

  // Step 1 性别 → 选择 Female → Next
  const genderOptions = page.locator(".onboarding-option");
  await expect(genderOptions).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const box = await genderOptions.nth(i).boundingBox();
    expect(box, "onboarding gender option should be visible").not.toBeNull();
    expect(box!.height, "onboarding gender option touch height").toBeGreaterThanOrEqual(48);
  }
  await genderOptions.nth(0).click();
  await page.locator(".onboarding-btn-primary").click();

  // Step 2 体重与目标（默认 60kg / Lose，可微调）→ Next
  await expect(page.locator(".onboarding-step")).toBeVisible();
  await page.locator(".onboarding-btn-primary").click();

  // Step 3 每日卡路里目标（自动推荐，可微调）→ Get Started
  await expect(page.locator(".onboarding-recommended")).toBeVisible();
  await page.locator(".onboarding-btn-primary").click();

  // 完成 → Onboarding 收起，主界面就绪
  await expect(page.locator(".onboarding-overlay")).toBeHidden({ timeout: 10000 });
  await expect(page.locator("nav.tab-bar button.tab")).toHaveCount(3);
}

/** 上传测试图片 → 触发 AI 识别 → 可选断言结构化拆解卡 */
async function uploadAndAnalyze(page: Page, expectCards = true) {
  const fileInput = page.locator('.upload-area input[type="file"]').nth(1);
  await fileInput.setInputFiles({ name: "meal.png", mimeType: "image/png", buffer: PNG_1x1 });
  await page.locator('button:has-text("Start AI Recognition")').click();
  if (expectCards) {
    await expect(page.locator(".food-item").first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".food-item")).toHaveCount(3); // 2 项 + 合计行
  }
}

/** 读取今日进度条（Dashboard 环形中央 kcal 数值） */
async function readRingKcal(page: Page): Promise<number> {
  await page.locator('nav.tab-bar button:has-text("Dashboard")').click();
  const ring = page.locator(".cal-ring-container svg text").first();
  await expect(ring).toBeVisible({ timeout: 10000 });
  return Number(await ring.textContent());
}

// ═══════════════════════════════════════════════════════════════════════
// [M3] Cal AI 核心链路 · 用例 1/3 —— 极简 Onboarding
// ═══════════════════════════════════════════════════════════════════════
test("M3.1 · 极简 Onboarding：登录 → 3 步设置（性别/体重目标/卡路里）→ 主界面就绪", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/");
  await loginWithGoogle(page);

  // 新账号未完成设置 → 自动弹出极简 Onboarding
  await expect(page.locator(".onboarding-overlay")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".onboarding-card")).toContainText("Set Up Your Goals");

  // Step 1 性别（Female/Male/Other）→ 触达高度 ≥48px + 选择 Female → Next
  const genderOptions = page.locator(".onboarding-option");
  await expect(genderOptions).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const box = await genderOptions.nth(i).boundingBox();
    expect(box, "onboarding gender option should be visible").not.toBeNull();
    expect(box!.height, "onboarding gender option touch height").toBeGreaterThanOrEqual(48);
  }
  await genderOptions.nth(0).click();
  await page.locator(".onboarding-btn-primary").click();

  // Step 2 体重与目标（默认 60kg / Lose）→ Next
  await expect(page.locator(".onboarding-step")).toBeVisible();
  const nextBox = await page.locator(".onboarding-btn-primary").boundingBox();
  expect(nextBox!.height, "onboarding next touch height").toBeGreaterThanOrEqual(48);
  await page.locator(".onboarding-btn-primary").click();

  // Step 3 每日卡路里目标（自动推荐可微调）→ Get Started
  await expect(page.locator(".onboarding-recommended")).toBeVisible();
  await page.locator(".onboarding-btn-primary").click();

  // 完成 → 主界面就绪
  await expect(page.locator(".onboarding-overlay")).toBeHidden({ timeout: 10000 });
  await expect(page.locator("nav.tab-bar button.tab")).toHaveCount(3);
});

// ═══════════════════════════════════════════════════════════════════════
// [M1] 按钮触达 ≥48px —— 移动端触达标准
// ═══════════════════════════════════════════════════════════════════════
test("M1 · 触达标准：核心交互按钮高度 ≥ 48px（iPhone 390x844）", async ({ page }) => {
  await bootstrap(page);
  await page.goto("/");
  await loginWithGoogle(page);
  await completeOnboarding(page);

  // 核心触达按钮：升级 / 登录 / 看广告 / 餐次 / 上传 / 导航 Tab
  const touchSelectors = [
    "button.btn-upgrade",
    "button.btn-login",
    "button.ad-reward-btn",
    "button.meal-type-btn",
    "button.upload-btn",
    "nav.tab-bar button.tab",
  ];
  for (const sel of touchSelectors) {
    const el = page.locator(sel).first();
    await el.waitFor({ state: "visible" });
    const box = await el.boundingBox();
    expect(box, `${sel} should be visible`).not.toBeNull();
    expect(box!.height, `${sel} touch height`).toBeGreaterThanOrEqual(48);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// [M3] Cal AI 核心链路 · 用例 2/3 —— 拍照 AI 拆解 → Save to Log → 今日进度条
// ═══════════════════════════════════════════════════════════════════════
test("M3.2 · 核心链路：拍照 AI 拆解 → Save to Log → 今日进度条数值增加", async ({ page }) => {
  await bootstrap(page);
  await page.goto("/");
  await loginWithGoogle(page);
  await completeOnboarding(page);

  // TEST-STUB：拦截识图接口返回确定性结构化拆解数据
  await page.route("**/api/v1/meals/analyze-image*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SCAN),
    })
  );

  // 初始今日进度为 0
  expect(await readRingKcal(page)).toBe(0);

  // 回到记录页
  await page.locator('nav.tab-bar button:has-text("Log Meal")').click();

  // 拍照上传 → AI 结构化拆解卡（名称/克数/卡路里/PFC）
  await uploadAndAnalyze(page);
  await expect(page.locator(".food-item .food-name").first()).toContainText("鸡胸肉");
  await expect(page.locator(".food-item .food-cal").nth(0)).toContainText("247");
  await expect(page.locator(".food-item .food-cal").nth(1)).toContainText("34");
  const macroText = await page.locator(".food-item .food-macro").first().textContent();
  expect(macroText).toMatch(/P\d+/);
  expect(macroText).toMatch(/F\d+/);
  expect(macroText).toMatch(/C\d+/);

  // Save to Log → 今日进度条 +kcal
  await page.locator("button.meal-save-btn").click();
  await expect(page.locator("button.meal-save-btn")).toContainText("Saved");
  expect(await readRingKcal(page)).toBe(EXPECTED_KCAL);
});

// ═══════════════════════════════════════════════════════════════════════
// [M2] 全英文 Stripe 路由 —— 免费 2 次后第 3 次拍照触发 $9.99/月 Pro 订阅
// ═══════════════════════════════════════════════════════════════════════
test("M2 · 全英文 Stripe 路由：免费 2 次后第 3 次拍照 → checkout.stripe.com + lang=en", async ({
  page,
}) => {
  await bootstrap(page);
  await page.goto("/");
  await loginWithGoogle(page);
  await completeOnboarding(page);

  // TEST-STUB：识图接口确定性数据（前 2 次免费识别）
  await page.route("**/api/v1/meals/analyze-image*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SCAN),
    })
  );
  // TEST-STUB：Stripe 订阅会话返回确定性 checkout URL（生产未配 key 仅演示降级，不静默跳转）
  await page.route("**/api/stripe/subscribe", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "cs_test_benchmark",
        url: STRIPE_CHECKOUT_URL,
        amount: 9.99,
        interval: "month",
        plan: "pro_monthly",
      }),
    })
  );

  await page.locator('nav.tab-bar button:has-text("Log Meal")').click();

  // 第 1 次拍照（免费）
  await uploadAndAnalyze(page);
  await expect(page.locator(".food-item")).toHaveCount(3);

  // 第 2 次拍照（免费）
  await uploadAndAnalyze(page);
  await expect(page.locator(".food-item")).toHaveCount(3);

  // 跳转前：应用 UI 全英文（<html lang="en">）
  await expect(page.locator("html")).toHaveAttribute("lang", /^en/i);

  // 第 3 次拍照 → 触发 $9.99/月 Pro 订阅 Paywall → 全英文 Stripe 路由
  await uploadAndAnalyze(page, false); // 不等待卡片：直接跳转 Stripe
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90000 });
  expect(page.url()).toContain("checkout.stripe.com");
});
