/**
 * Cal AI 对标移动端闭环 Benchmark（390x844 iPhone 13）
 *
 * a. 校验首页 Mobile UI 触达按钮高度 >= 48px；
 * b. 模拟上传测试图片 → 断言 AI 返回结构化卡路里/三大营养素卡片；
 * c. 点击 Save to Log → 断言首页环形进度条数值增加；
 * d. 触发第 3 次拍照 → 断言跳转全英文 Stripe Checkout（locale=en）。
 *
 * 前置：Google 1 秒登录（OAuth stub）→ 新账号获得 2 次免费拍照，
 * 第 3 次拍照触发 $9.99/月 Pro 订阅 Paywall。
 */

import { test, expect, type Page } from "@playwright/test";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// 与真实 analyze-image 路由返回结构一致（结构化拆解：名称/克数/PFC/卡路里）
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

async function loginWithGoogle(page: Page) {
  await page.locator("button.btn-login").click();
  await page.locator(".auth-social-btn", { hasText: "Google" }).click();
  await expect(page.locator(".login-modal")).toBeHidden({ timeout: 15000 });
  // Google 1 秒登录成功 → Header 显示 google_user
  await expect(page.locator("button.btn-login")).toContainText("google_user", { timeout: 10000 });
}

async function uploadAndAnalyze(page: Page, expectCards = true) {
  const fileInput = page.locator('.upload-area input[type="file"]').nth(1);
  await fileInput.setInputFiles({ name: "meal.png", mimeType: "image/png", buffer: PNG_1x1 });
  await page.locator('button:has-text("Start AI Recognition")').click();
  if (expectCards) {
    await expect(page.locator(".food-item").first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".food-item")).toHaveCount(3); // 2 项 + 合计行
  }
}

async function readRingKcal(page: Page): Promise<number> {
  await page.locator('nav.tab-bar button:has-text("Dashboard")').click();
  const ring = page.locator(".cal-ring-container svg text").first();
  await expect(ring).toBeVisible({ timeout: 10000 });
  return Number(await ring.textContent());
}

test("Cal AI mobile closed-loop: UI touch → scan → save → 3rd photo paywall (Stripe en)", async ({
  page,
}) => {
  // 稳定英文 UI + 已 Onboard 画像 + 清空历史餐食/扫描计数
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("calorieai_locale", "en");
    localStorage.setItem(
      "calorieai_profile",
      JSON.stringify({
        gender: "female",
        weightKg: 60,
        goal: "lose",
        heightCm: 165,
        age: 28,
        dailyCalories: 1800,
        onboarded: true,
      })
    );
  });

  // 拦截 AI 识别接口：返回结构化拆解数据（确定性）
  await page.route("**/api/v1/meals/analyze-image*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SCAN),
    })
  );

  await page.goto("/");

  // ── 0. Google 1 秒登录 ───────────────────────────────
  await loginWithGoogle(page);

  // ── a. Mobile UI 触达按钮高度 >= 48px ────────────────
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

  // ── 初始环形进度为 0 ─────────────────────────────────
  expect(await readRingKcal(page)).toBe(0);

  // 回到记录页
  await page.locator('nav.tab-bar button:has-text("Log Meal")').click();

  // ── b. 第 1 次拍照：AI 结构化拆解卡片 ────────────────
  await uploadAndAnalyze(page);
  await expect(page.locator(".food-item .food-name").first()).toContainText("鸡胸肉");
  await expect(page.locator(".food-item .food-cal").nth(0)).toContainText("247");
  await expect(page.locator(".food-item .food-cal").nth(1)).toContainText("34");
  const macroText = await page.locator(".food-item .food-macro").first().textContent();
  expect(macroText).toMatch(/P\d+/);
  expect(macroText).toMatch(/F\d+/);
  expect(macroText).toMatch(/C\d+/);

  // ── c. Save to Log → 环形进度增加 ────────────────────
  await page.locator("button.meal-save-btn").click();
  await expect(page.locator("button.meal-save-btn")).toContainText("Saved");
  expect(await readRingKcal(page)).toBe(EXPECTED_KCAL);

  // 回到记录页
  await page.locator('nav.tab-bar button:has-text("Log Meal")').click();

  // ── 第 2 次拍照（免费）───────────────────────────────
  await uploadAndAnalyze(page);
  await expect(page.locator(".food-item")).toHaveCount(3);

  // ── d. 第 3 次拍照：触发 $9.99 全英文 Stripe 订阅 Paywall ──
  await uploadAndAnalyze(page, false); // 不等待卡片：直接跳转 Stripe
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90000 });
  expect(page.url()).toContain("checkout.stripe.com");
  // 全英文校验：<html lang="en">
  await expect(page.locator("html")).toHaveAttribute("lang", /^en/i, { timeout: 30000 });
});
