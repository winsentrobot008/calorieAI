#!/usr/bin/env node
/**
 * check-credit-rules.mjs — 积分新规门禁（每日免费额度 + 广告奖励上限 + 1 RMB = 1 Credit）
 *
 * 断言（服务端权威行为，禁止只测纯函数）：
 *   a. 免费额度：新账号无记录时 GET 返回 0（不隐式建号）；
 *   b. 建档后余额 3（DEFAULT_FREE_CREDITS）；
 *   c. 广告奖励：1 广告 = 1 积分，连续 3 次成功（余额 4/5/6）；
 *   d. 第 4 次 → HTTP 400 + code/error = AD_DAILY_LIMIT_REACHED；
 *   e. GET 回读 daily_ad_views_today = 3（服务端权威计数）；
 *   f. 日切重置：把 last_reset_timestamp 改为昨日 → 余额补足回 3、计数清零；
 *   g. 定价基准：Stripe mock 会话 pack_starter = ¥1/1 积分、pack_power = ¥30/35 积分（CNY）。
 *
 * 前置：先 `npm run build`。
 * 用法：node scripts/check-credit-rules.mjs      # 退出码 0 = 全绿
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const APP_PORT = Number(process.env.PORT || 3120);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const READY_TIMEOUT_MS = 120_000;
const INTERNAL_SECRET = "qa-internal-secret";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const STORE_FILE = path.join(os.tmpdir(), "calorieai-data", "credits.json");

const FREE_CREDITS = 3;
const AD_LIMIT = 3;
const AD_REWARD = 1;
const AD_LIMIT_CODE = "AD_DAILY_LIMIT_REACHED";

let failures = 0;

const RUN_SEED = Math.floor(Math.random() * 200);
const TEST_IP = `203.0.113.${(RUN_SEED % 200) + 1}`;
const TEST_USER = `user_${crypto.createHash("sha256").update(`credit-rules-${Date.now()}`).digest("hex").slice(0, 16)}`;
const FRESH_USER = `user_${crypto.createHash("sha256").update(`fresh-${Date.now()}`).digest("hex").slice(0, 16)}`;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✅ ${label}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

function headers(extra = {}) {
  return { "Content-Type": "application/json", "User-Agent": BROWSER_UA, "x-forwarded-for": TEST_IP, ...extra };
}

async function waitForApp() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5_000) });
      if (res.status < 500) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function getCredits(userId) {
  const res = await fetch(`${BASE}/api/v1/user/credits?user_id=${encodeURIComponent(userId)}`, {
    headers: headers(),
  });
  return { status: res.status, body: await res.json() };
}

async function grantCredits(userId, delta) {
  const res = await fetch(`${BASE}/api/v1/user/credits`, {
    method: "POST",
    headers: headers({ "x-internal-secret": INTERNAL_SECRET }),
    body: JSON.stringify({ user_id: userId, delta, action: "manual" }),
  });
  return { status: res.status, body: await res.json() };
}

async function claimAdReward(userId) {
  const res = await fetch(`${BASE}/api/v1/billing/ad-reward`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ user_id: userId }),
  });
  return { status: res.status, body: await res.json() };
}

async function stripeCheckoutMock(packId) {
  const res = await fetch(`${BASE}/api/stripe/checkout`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ pack_id: packId, user_id: TEST_USER }),
  });
  return { status: res.status, body: await res.json() };
}

/** 直接改写文件存储，模拟「昨天已用满免费额度与广告次数」的历史档案 */
function seedYesterdayProfile(userId, credits) {
  if (!fs.existsSync(STORE_FILE)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, "utf-8"));
    if (!data?.credits?.[userId]) return false;
    const yesterday = Date.now() - 36 * 60 * 60 * 1000;
    data.credits[userId] = {
      user_id: userId,
      credits,
      last_reset_timestamp: yesterday,
      daily_free_used: FREE_CREDITS,
      daily_ad_views_today: AD_LIMIT,
      updated_at: new Date(yesterday).toISOString(),
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const server = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "start", "-p", String(APP_PORT)], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      INTERNAL_API_SECRET: INTERNAL_SECRET,
      NODE_ENV: "production",
    },
    stdio: "ignore",
    shell: process.platform === "win32",
  });

  try {
    if (!(await waitForApp())) throw new Error(`server did not become ready on ${BASE}`);

    console.log("\n[1] 免费额度：无记录账号不隐式建号");
    const fresh = await getCredits(FRESH_USER);
    check("新账号 GET 返回 0 积分", fresh.body?.credits === 0, JSON.stringify(fresh.body));
    check("响应暴露每日免费额度 = 3", fresh.body?.daily_free_quota === FREE_CREDITS, String(fresh.body?.daily_free_quota));
    check("响应暴露每日广告上限 = 3", fresh.body?.daily_ad_limit === AD_LIMIT, String(fresh.body?.daily_ad_limit));
    check("响应暴露单次广告奖励 = 1", fresh.body?.ad_reward_credits === AD_REWARD, String(fresh.body?.ad_reward_credits));

    console.log("\n[2] 建档：初始化赠送 3 积分");
    const created = await grantCredits(TEST_USER, 0);
    check("建档成功且余额 = 3", created.body?.credits === FREE_CREDITS, JSON.stringify(created.body));

    console.log("\n[3] 广告奖励：1 广告 = 1 积分，每日上限 3 次");
    for (let i = 1; i <= AD_LIMIT; i += 1) {
      const r = await claimAdReward(TEST_USER);
      const expected = FREE_CREDITS + i * AD_REWARD;
      check(
        `第 ${i} 次领取成功（+${AD_REWARD} 积分，余额 = ${expected}）`,
        r.status === 200 && r.body?.rewarded === true && r.body?.credits === expected,
        `status=${r.status} body=${JSON.stringify(r.body)}`
      );
    }

    console.log("\n[4] 超限拒绝：第 4 次 → 400 AD_DAILY_LIMIT_REACHED");
    const over = await claimAdReward(TEST_USER);
    check("HTTP 400", over.status === 400, `status=${over.status}`);
    check(
      "错误码 = AD_DAILY_LIMIT_REACHED",
      over.body?.error === AD_LIMIT_CODE || over.body?.code === AD_LIMIT_CODE,
      JSON.stringify(over.body)
    );
    check("未发放奖励（rewarded=false）", over.body?.rewarded === false, String(over.body?.rewarded));

    console.log("\n[5] 服务端权威计数回读");
    const after = await getCredits(TEST_USER);
    check(
      `daily_ad_views_today = ${AD_LIMIT}`,
      after.body?.daily_ad_views_today === AD_LIMIT,
      String(after.body?.daily_ad_views_today)
    );

    console.log("\n[6] 日切重置：跨自然日补足免费额度并清零计数");
    if (fs.existsSync(STORE_FILE)) {
      const seeded = seedYesterdayProfile(TEST_USER, 0);
      check("已写入「昨日档案」用于验证日切", seeded, STORE_FILE);
      if (seeded) {
        const reset = await getCredits(TEST_USER);
        check(
          `余额补足回 ${FREE_CREDITS}`,
          reset.body?.credits === FREE_CREDITS,
          `credits=${reset.body?.credits}`
        );
        check("daily_free_used 清零", reset.body?.daily_free_used === 0, String(reset.body?.daily_free_used));
        check(
          "daily_ad_views_today 清零",
          reset.body?.daily_ad_views_today === 0,
          String(reset.body?.daily_ad_views_today)
        );
        const sameDay = await claimAdReward(TEST_USER);
        check(
          "重置后当日可再次领取广告奖励",
          sameDay.status === 200 && sameDay.body?.credits === FREE_CREDITS + AD_REWARD,
          `status=${sameDay.status} body=${JSON.stringify(sameDay.body)}`
        );
      }
    } else {
      console.log("  ⏭  跳过：当前未使用文件适配器（已配置 Postgres / KV）");
    }

    console.log("\n[7] 定价基准：1 RMB = 1 Credit");
    const p1 = await stripeCheckoutMock("pack_starter");
    if (p1.body?.mock === true) {
      check("pack_starter = ¥1 / 1 积分", p1.body?.amount === 1 && p1.body?.credits === 1, JSON.stringify(p1.body));
      check("结算币种 = CNY", p1.body?.currency === "CNY", String(p1.body?.currency));
      const p3 = await stripeCheckoutMock("pack_power");
      check("pack_power = ¥30 / 35 积分（含赠送）", p3.body?.amount === 30 && p3.body?.credits === 35, JSON.stringify(p3.body));
      const p2 = await stripeCheckoutMock("pack_booster");
      check("pack_booster = ¥10 / 10 积分", p2.body?.amount === 10 && p2.body?.credits === 10, JSON.stringify(p2.body));
    } else {
      console.log("  ⏭  跳过：Stripe 已配置真实密钥，mock 定价回显不可用");
    }
  } finally {
    server.kill();
  }

  console.log(failures === 0 ? "\n✅ Credit rules check passed" : `\n❌ Credit rules check FAILED (${failures})`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();