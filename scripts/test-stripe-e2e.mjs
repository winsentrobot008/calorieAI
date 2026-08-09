#!/usr/bin/env node

/**
 * ⚠️ 遗留脚本（订阅模式，已弃用）
 *
 * 商业化已切换为 Credits Top-up（积分充值/按次付费）一次性付款：
 *   - 订阅激活 / 续费 / 停用逻辑已从 Webhook 移除；
 *   - 当前回归请使用 `npm run qa:ui` / `npm run test` / `npm run test:api`。
 *
 * 本脚本仅保留作为旧订阅模式的历史 E2E 参考，不再作为交付门禁。
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data/subscriptions.json");

// ─── Colors ─────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

let passed = 0;
let failed = 0;
let testId = 0;

function test(name, fn) {
  testId++;
  const id = `${testId}`.padStart(2, "0");
  try {
    fn();
    passed++;
    console.log(`  ${C.green}✓${C.reset} [${id}] ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ${C.red}✗${C.reset} [${id}] ${name}`);
    console.log(`    ${C.red}${err.message}${C.reset}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepMatch(actual, expected, path = "") {
  for (const key of Object.keys(expected)) {
    const fullPath = path ? `${path}.${key}` : key;
    if (typeof expected[key] === "object" && expected[key] !== null && !Array.isArray(expected[key])) {
      if (typeof actual[key] !== "object" || actual[key] === null) {
        throw new Error(`${fullPath}: expected object, got ${typeof actual[key]}`);
      }
      assertDeepMatch(actual[key], expected[key], fullPath);
    } else {
      assertEqual(actual[key], expected[key], fullPath);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function clearData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const dir = path.dirname(DATA_FILE);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return { subscriptions: {} };
  }
}

function getSubscription(userId) {
  const data = readData();
  return data.subscriptions[userId] || null;
}

// ─── Simulated Webhook Logic ────────────────────────────────────────
// 这里直接复现 webhook/route.ts 中的核心逻辑，但不依赖 Next.js

function simulateCheckoutCompleted({ userId, email, plan, planType, isPermanent }) {
  const now = new Date();
  let periodEnd;
  if (isPermanent) {
    periodEnd = new Date("2099-12-31T23:59:59Z");
  } else if (plan === "yearly") {
    periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  } else {
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  // 直接使用 billing-store 的逻辑（内联以避免 ES module 问题）
  const store = readData();
  const existing = store.subscriptions[userId];

  const record = {
    user_id: userId,
    email: email || "",
    plan_type: planType || "subscription",
    plan: plan || "monthly",
    is_active: true,
    is_permanent: !!isPermanent,
    stripe_customer_id: `cus_test_${userId}`,
    stripe_subscription_id: planType === "license" ? null : `sub_test_${userId}`,
    stripe_session_id: `cs_test_${userId}`,
    provider: "stripe",
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    created_at: existing?.created_at || now.toISOString(),
    updated_at: now.toISOString(),
  };

  store.subscriptions[userId] = record;

  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");

  return record;
}

function simulateInvoicePaid(userId) {
  const store = readData();
  const existing = store.subscriptions[userId];
  if (!existing) throw new Error(`Subscription not found for ${userId}`);

  const now = new Date();
  let periodEnd;
  if (existing.is_permanent) {
    periodEnd = new Date("2099-12-31T23:59:59Z");
  } else if (existing.plan === "yearly") {
    periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  } else {
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  existing.is_active = true;
  existing.current_period_start = now.toISOString();
  existing.current_period_end = periodEnd.toISOString();
  existing.updated_at = now.toISOString();

  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  return existing;
}

function simulateSubscriptionDeleted(userId) {
  const store = readData();
  const existing = store.subscriptions[userId];
  if (!existing) throw new Error(`Subscription not found for ${userId}`);

  existing.is_active = false;
  existing.updated_at = new Date().toISOString();

  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  return existing;
}

function getStatus(userId) {
  const record = getSubscription(userId);
  if (!record) {
    return {
      is_premium: false,
      is_permanent: false,
      remaining_daily_recognitions: 3,
      daily_free_uses: 3,
      ad_reward_credits: 0,
      free_tier: true,
      subscription: null,
    };
  }

  const now = new Date();
  const periodEnd = new Date(record.current_period_end);
  const isExpired = periodEnd < now;
  const isPremium = record.is_active && !isExpired;

  return {
    is_premium: isPremium,
    is_permanent: record.is_permanent && isPremium,
    remaining_daily_recognitions: isPremium ? 999 : 3,
    daily_free_uses: 3,
    ad_reward_credits: 0,
    free_tier: !isPremium,
    subscription: {
      plan: record.plan,
      plan_type: record.plan_type,
      provider: record.provider,
      is_active: isPremium,
      current_period_start: record.current_period_start,
      current_period_end: record.current_period_end,
      is_expired: isExpired,
    },
  };
}

// ─── Main Test Runner ───────────────────────────────────────────────

function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║        Stripe 支付全链路端到端测试 (E2E)              ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════╝${C.reset}`);

  // ── Setup: Start clean ────────────────────────────────
  clearData();
  console.log(`\n  ${C.dim}测试环境已重置 (data/ 已清空)${C.reset}\n`);

  // ═══════════════════════════════════════════════════════
  //  Test 1: 月付订阅 → checkout.session.completed
  // ═══════════════════════════════════════════════════════
  test("月付订阅 - checkout.session.completed → 激活订阅", () => {
    const result = simulateCheckoutCompleted({
      userId: "user_test_monthly",
      email: "monthly@test.com",
      plan: "monthly",
      planType: "subscription",
      isPermanent: false,
    });

    assertEqual(result.is_active, true, "is_active");
    assertEqual(result.plan, "monthly", "plan");
    assertEqual(result.plan_type, "subscription", "plan_type");
    assertEqual(result.is_permanent, false, "is_permanent");
    assertEqual(result.provider, "stripe", "provider");

    // 验证到期时间约等于 1 个月后
    const periodEnd = new Date(result.current_period_end);
    const now = new Date();
    const monthLater = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const diffMs = Math.abs(periodEnd.getTime() - monthLater.getTime());
    assert(diffMs < 86400000, `到期时间应在1个月左右 (差 ${Math.round(diffMs / 3600000)}h)`);
  });

  // ═══════════════════════════════════════════════════════
  //  Test 2: 年付订阅
  // ═══════════════════════════════════════════════════════
  test("年付订阅 - checkout.session.completed → 激活订阅", () => {
    const result = simulateCheckoutCompleted({
      userId: "user_test_yearly",
      email: "yearly@test.com",
      plan: "yearly",
      planType: "subscription",
      isPermanent: false,
    });

    assertEqual(result.is_active, true, "is_active");
    assertEqual(result.plan, "yearly", "plan");
    assertEqual(result.is_permanent, false, "is_permanent");

    // 验证到期时间约等于 1 年后
    const periodEnd = new Date(result.current_period_end);
    const now = new Date();
    const yearLater = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    const diffMs = Math.abs(periodEnd.getTime() - yearLater.getTime());
    assert(diffMs < 86400000, `到期时间应在1年左右 (差 ${Math.round(diffMs / 3600000)}h)`);
  });

  // ═══════════════════════════════════════════════════════
  //  Test 3: 永久买断
  // ═══════════════════════════════════════════════════════
  test("永久买断 - checkout.session.completed → 永久激活", () => {
    const result = simulateCheckoutCompleted({
      userId: "user_test_permanent",
      email: "perm@test.com",
      plan: "permanent",
      planType: "license",
      isPermanent: true,
    });

    assertEqual(result.is_active, true, "is_active");
    assertEqual(result.is_permanent, true, "is_permanent");
    assertEqual(result.plan_type, "license", "plan_type");

    // 永久买断到期时间是 2099-12-31
    assertEqual(result.current_period_end, "2099-12-31T23:59:59.000Z", "current_period_end (2099)");
  });

  // ═══════════════════════════════════════════════════════
  //  Test 4: 续费成功 (invoice.payment_succeeded)
  // ═══════════════════════════════════════════════════════
  test("续费 - invoice.payment_succeeded → 延长有效期", () => {
    // 先创建一个即将到期的订阅
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 1); // 昨天就过期了

    // 手动写入一个旧记录
    const store = readData();
    store.subscriptions["user_test_renewal"] = {
      user_id: "user_test_renewal",
      email: "renewal@test.com",
      plan_type: "subscription",
      plan: "monthly",
      is_active: true,
      is_permanent: false,
      stripe_customer_id: "cus_test_renewal",
      stripe_subscription_id: "sub_test_renewal",
      stripe_session_id: "cs_test_renewal",
      provider: "stripe",
      current_period_start: new Date(oldDate.getTime() - 86400000).toISOString(),
      current_period_end: oldDate.toISOString(),
      created_at: new Date(oldDate.getTime() - 86400000).toISOString(),
      updated_at: oldDate.toISOString(),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");

    // 模拟续费
    const result = simulateInvoicePaid("user_test_renewal");

    assertEqual(result.is_active, true, "续费后 is_active 应为 true");

    // 到期时间应更新到一个月后
    const periodEnd = new Date(result.current_period_end);
    const now = new Date();
    const monthLater = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const diffMs = Math.abs(periodEnd.getTime() - monthLater.getTime());
    assert(diffMs < 86400000, `续费后到期时间应在1个月左右 (差 ${Math.round(diffMs / 3600000)}h)`);
  });

  // ═══════════════════════════════════════════════════════
  //  Test 5: 取消订阅
  // ═══════════════════════════════════════════════════════
  test("取消订阅 - customer.subscription.deleted → 停用", () => {
    const result = simulateSubscriptionDeleted("user_test_monthly");
    assertEqual(result.is_active, false, "取消后 is_active 应为 false");
  });

  // ═══════════════════════════════════════════════════════
  //  Test 6: 状态查询 — 验证完整状态
  // ═══════════════════════════════════════════════════════
  test("状态查询 - 已取消的用户 → free_tier: true", () => {
    const status = getStatus("user_test_monthly");
    assertEqual(status.is_premium, false, "取消用户 is_premium 应为 false");
    assertEqual(status.free_tier, true, "取消用户 free_tier 应为 true");
    assertEqual(status.remaining_daily_recognitions, 3, "免费用户应只有 3 次识别");
  });

  test("状态查询 - 永久买断用户 → is_premium: true, is_permanent: true", () => {
    const status = getStatus("user_test_permanent");
    assertEqual(status.is_premium, true, "永久用户 is_premium");
    assertEqual(status.is_permanent, true, "永久用户 is_permanent");
    assertEqual(status.remaining_daily_recognitions, 999, "永久用户无限次识别");
    assertEqual(status.free_tier, false, "永久用户 free_tier 应为 false");
    assert(status.subscription !== null, "永久用户应有 subscription 对象");
    assertEqual(status.subscription.plan, "permanent", "subscription.plan");
    assertEqual(status.subscription.plan_type, "license", "subscription.plan_type");
  });

  test("状态查询 - 活跃年付用户 → is_premium: true", () => {
    const status = getStatus("user_test_yearly");
    assertEqual(status.is_premium, true, "年付用户 is_premium");
    assertEqual(status.is_permanent, false, "年付用户 is_permanent");
    assertEqual(status.remaining_daily_recognitions, 999, "年付用户无限次识别");
    assertEqual(status.free_tier, false, "年付用户 free_tier");
    assertEqual(status.subscription.plan, "yearly", "subscription.plan");
  });

  test("状态查询 - 未注册用户 → free_tier: true", () => {
    const status = getStatus("nonexistent_user");
    assertEqual(status.is_premium, false, "未注册用户 is_premium");
    assertEqual(status.free_tier, true, "未注册用户 free_tier");
    assert(status.subscription === null, "未注册用户 subscription 应为 null");
  });

  // ═══════════════════════════════════════════════════════
  //  Test 7: 续费后状态更新
  // ═══════════════════════════════════════════════════════
  test("续费后状态查询 → is_premium: true, 到期时间已更新", () => {
    const status = getStatus("user_test_renewal");
    assertEqual(status.is_premium, true, "续费后 is_premium");
    assertEqual(status.free_tier, false, "续费后 free_tier");
    assertEqual(status.subscription.is_expired, false, "续费后未过期");
  });

  // ═══════════════════════════════════════════════════════
  //  Test 8: 数据完整性检查
  // ═══════════════════════════════════════════════════════
  test("数据完整性 - 验证 data/subscriptions.json 结构", () => {
    const data = readData();
    assert(typeof data === "object", "data 应为对象");
    assert(typeof data.subscriptions === "object", "data.subscriptions 应为对象");

    const keys = Object.keys(data.subscriptions);
    assert(keys.length >= 4, `应有至少 4 条记录, 现有 ${keys.length}`);

    // 验证每条记录的必要字段
    for (const userId of keys) {
      const sub = data.subscriptions[userId];
      const requiredFields = ["user_id", "email", "plan_type", "plan", "is_active", "is_permanent",
        "provider", "current_period_start", "current_period_end", "created_at", "updated_at"];
      for (const field of requiredFields) {
        assert(sub[field] !== undefined && sub[field] !== null,
          `${userId} 缺少字段: ${field}`);
      }
    }
  });

  // ═══════════════════════════════════════════════════════
  //  Test 9: PayPal 订阅激活 (Billing Subscribe API 逻辑)
  // ═══════════════════════════════════════════════════════
  test("PayPal 订阅激活 - subscribe API 逻辑", () => {
    const userId = "user_paypal_test";
    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const store = readData();
    store.subscriptions[userId] = {
      user_id: userId,
      email: "paypal@test.com",
      plan_type: "subscription",
      plan: "monthly",
      is_active: true,
      is_permanent: false,
      paypal_order_id: "PAYPAL_ORDER_TEST",
      provider: "paypal",
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");

    const status = getStatus(userId);
    assertEqual(status.is_premium, true, "PayPal 用户 is_premium");
    assertEqual(status.subscription.provider, "paypal", "provider 应为 paypal");
  });

  // ═══════════════════════════════════════════════════════
  //  Test 10: 过期订阅状态
  // ═══════════════════════════════════════════════════════
  test("过期订阅 → is_premium: false, is_expired: true", () => {
    const userId = "user_expired_test";
    const oldDate = new Date("2020-01-01"); // 明显已过期

    const store = readData();
    store.subscriptions[userId] = {
      user_id: userId,
      email: "expired@test.com",
      plan_type: "subscription",
      plan: "monthly",
      is_active: true, // 本地状态还没更新，但时间已过期
      is_permanent: false,
      stripe_customer_id: "cus_expired",
      stripe_subscription_id: "sub_expired",
      provider: "stripe",
      current_period_start: "2019-12-01T00:00:00.000Z",
      current_period_end: "2020-01-01T00:00:00.000Z",
      created_at: "2019-12-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");

    const status = getStatus(userId);
    assertEqual(status.is_premium, false, "过期用户 is_premium 应为 false");
    assertEqual(status.subscription.is_expired, true, "subscription.is_expired 应为 true");
    assertEqual(status.remaining_daily_recognitions, 3, "过期用户应降级为 3 次识别");
  });

  // ── Summary ────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n  ${C.dim}${"─".repeat(52)}${C.reset}`);
  console.log(`  ${C.bold}结果: ${failed === 0 ? C.green + "全部通过" : C.red + failed + " 失败"}${C.reset} (${passed}/${total})`);

  // Cleanup
  clearData();
  console.log(`  ${C.dim}测试数据已清理${C.reset}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
