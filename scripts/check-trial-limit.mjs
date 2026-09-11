#!/usr/bin/env node
/**
 * check-trial-limit.mjs — 上线测试期频控门禁（DeepSeek 主调 + 普通用户 3 次/24h + 管理员豁免）
 *
 * 1) 启动本地 DeepSeek 兼容桩服务（OpenAI chat/completions，返回固定营养 JSON）；
 * 2) 以 DEEPSEEK_API_KEY=test / DEEPSEEK_BASE_URL=<stub> 启动 `next start`；
 * 3) 断言：
 *      a. 普通用户（IP 判重）第 1-3 次 200，第 4 次 429 + 指定文案 + code=TRIAL_DAILY_LIMIT；
 *      b. 管理员静态令牌（x-admin-token + ADMIN_API_TOKEN）不受限，连续调用均非 429；
 *      c. 管理员 user_id（管理员邮箱稳定派生 ID）不受限；
 *      d. 识图链路同样走 DeepSeek 兼容接口且受同一频控。
 *
 * 前置：先 `npm run build`（复用 smoke-api 的构建产物）。
 * 用法：node scripts/check-trial-limit.mjs      # 退出码 0 = 全绿
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const APP_PORT = Number(process.env.PORT || 3110);
const STUB_PORT = Number(process.env.STUB_PORT || 3999);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const READY_TIMEOUT_MS = 120_000;
const ADMIN_TOKEN = "qa-admin-token";
const INTERNAL_SECRET = "qa-internal-secret";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const LIMIT_MESSAGE = "测试阶段普通用户每天限额 3 次，如需更多额度请联系管理员";

let failures = 0;

/**
 * 每次运行随机取一组测试 IP：匿名请求按 IP 派生稳定 user_id，
 * 随机化可避免上一轮运行留下的积分/额度残留影响断言。
 */
const RUN_SEED = Math.floor(Math.random() * 200);
const ipFor = (offset) => `198.51.100.${((RUN_SEED + offset) % 200) + 1}`;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✅ ${label}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${label}${detail ? ` → ${detail}` : ""}`);
  }
}

/** 管理员邮箱派生的稳定 user_id（与 src/lib/user-identity.ts 的 stableUserId 一致） */
function stableUserId(email) {
  return `user_${crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16)}`;
}

const STUB_RECORDS = [
  {
    food_name: "测试餐 (1 份 / 约 150g)",
    food_en: "qa test meal",
    grams: 150,
    estimated_calories: 210,
    macronutrients: { protein_g: 12, fat_g: 6, carbs_g: 26 },
    confidence_score: 0.9,
  },
];

function startStubProvider() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "qa-stub",
          object: "chat.completion",
          model: "deepseek-chat",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(STUB_RECORDS) } }],
        })
      );
    });
  });
  return new Promise((resolve) => server.listen(STUB_PORT, "127.0.0.1", () => resolve(server)));
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

function headers(ip, extra = {}) {
  return { "Content-Type": "application/json", "User-Agent": BROWSER_UA, "x-forwarded-for": ip, ...extra };
}

async function analyzeText(ip, userId, extraHeaders = {}) {
  const res = await fetch(`${BASE}/api/v1/meals/analyze-text`, {
    method: "POST",
    headers: headers(ip, extraHeaders),
    body: JSON.stringify({ text: "测试餐 150g", meal_type: "lunch", user_id: userId }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** 模拟登录/注册时的账号初始化（服务端可信调用：x-internal-secret） */
async function grantCredits(userId, delta = 3) {
  const res = await fetch(`${BASE}/api/v1/user/credits`, {
    method: "POST",
    headers: headers("127.0.0.1", { "x-internal-secret": INTERNAL_SECRET }),
    body: JSON.stringify({ user_id: userId, delta, action: "manual" }),
    signal: AbortSignal.timeout(15_000),
  });
  return res.status;
}

async function analyzeImage(ip, userId, extraHeaders = {}) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), "qa-trial.png");
  fd.append("meal_type", "lunch");
  fd.append("user_id", userId);
  const res = await fetch(`${BASE}/api/v1/meals/analyze-image`, {
    method: "POST",
    headers: { "User-Agent": BROWSER_UA, "x-forwarded-for": ip, ...extraHeaders },
    body: fd,
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  if (!existsSync(join(rootDir, ".next", "BUILD_ID"))) {
    console.error("请先运行 `npm run build`（缺少 .next/BUILD_ID）");
    process.exit(1);
  }

  const stub = await startStubProvider();
  const child = spawn(process.execPath, [join(rootDir, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(APP_PORT)], {
    cwd: rootDir,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: "qa-stub-key",
      DEEPSEEK_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
      ADMIN_API_TOKEN: ADMIN_TOKEN,
      INTERNAL_API_SECRET: INTERNAL_SECRET,
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      VERCEL_KV_REST_API_URL: "",
      VERCEL_KV_REST_API_TOKEN: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  try {
    if (!(await waitForApp())) throw new Error("next start 启动超时");

    console.log("=== a) 普通用户：3 次放行，第 4 次 429 + 指定文案 ===");
    const normalUser = "user_0000000000000000";
    const ipA = ipFor(0);
    for (let i = 1; i <= 3; i += 1) {
      const r = await analyzeText(ipA, normalUser);
      check(`第 ${i} 次分析放行（期望 200）`, r.status === 200, `status=${r.status} code=${r.data?.code || "-"}`);
    }
    const blocked = await analyzeText(ipA, normalUser);
    check("第 4 次被拦截（期望 429）", blocked.status === 429, `status=${blocked.status}`);
    check("超限错误码 = TRIAL_DAILY_LIMIT", blocked.data?.code === "TRIAL_DAILY_LIMIT", String(blocked.data?.code));
    check("超限文案逐字一致", blocked.data?.detail === LIMIT_MESSAGE, String(blocked.data?.detail));
    const blockedImage = await analyzeImage(ipA, normalUser);
    check("识图链路同样受限（期望 429）", blockedImage.status === 429, `status=${blockedImage.status}`);

    console.log("=== b) 管理员静态令牌：不受限（且跳过积分预扣） ===");
    const ipB = ipFor(1);
    for (let i = 1; i <= 5; i += 1) {
      const r = await analyzeText(ipB, normalUser, { "x-admin-token": ADMIN_TOKEN });
      check(`管理员令牌第 ${i} 次调用不受限（期望 200）`, r.status === 200, `status=${r.status}`);
    }
    const adminImage = await analyzeImage(ipB, normalUser, { "x-admin-token": ADMIN_TOKEN });
    check("管理员令牌识图不受限（期望 200）", adminImage.status === 200, `status=${adminImage.status}`);

    console.log("=== c) 管理员 user_id（稳定派生 ID）：不受限 ===");
    const adminId = stableUserId("winsentrobot008@gmail.com");
    const ipC = ipFor(2);
    const primed = await grantCredits(adminId);
    check("管理员账号初始化成功（模拟登录赠送额度）", primed === 200, `status=${primed}`);
    for (let i = 1; i <= 5; i += 1) {
      const r = await analyzeText(ipC, adminId);
      check(`管理员账号第 ${i} 次调用不受限（期望 200）`, r.status === 200, `status=${r.status}`);
    }

    console.log("=== d) DeepSeek 主调链路（模型标记）===");
    const sample = await analyzeText(ipFor(3), normalUser);
    check("响应 provider = deepseek", sample.data?.model?.provider === "deepseek", String(sample.data?.model?.provider));
  } finally {
    child.kill();
    stub.close();
  }

  console.log(
    failures === 0
      ? "\n✅ 测试期频控门禁全部通过（3 次/24h + 管理员豁免 + DeepSeek 主调）"
      : `\n❌ 测试期频控门禁失败 ${failures} 项`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`❌ 门禁执行异常: ${err?.message || err}`);
  process.exit(1);
});
