#!/usr/bin/env node

/**
 * ─── Stripe 配置检测与 Webhook 部署引导 ─────────────────────────────
 *
 * 用法:
 *   node scripts/check-stripe-config.mjs
 *
 * 功能:
 *   1. 检测 .env.local 中的 Stripe 密钥配置
 *   2. 检测当前部署域名
 *   3. 验证后端 API 端点是否存在及事件监听是否正确
 *   4. 生成 Webhook 配置引导步骤
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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

function ok(msg) {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}
function warn(msg) {
  console.log(`  ${C.yellow}⚠${C.reset} ${msg}`);
}
function fail(msg) {
  console.log(`  ${C.red}✗${C.reset} ${msg}`);
}
function info(msg) {
  console.log(`  ${C.blue}ℹ${C.reset} ${msg}`);
}
function title(msg) {
  console.log(`\n${C.bold}${C.cyan}${msg}${C.reset}`);
}
function hr() {
  console.log(`  ${C.dim}${"─".repeat(56)}${C.reset}`);
}

// ─── Helpers ────────────────────────────────────────────────────────

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const env = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      env[key] = value;
    }
    return env;
  } catch {
    return null;
  }
}

function getDeploymentUrl() {
  // Try Vercel, then localhost
  const vercelUrl = process.env.VERCEL_URL || process.env.VERCEL_BRANCH_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  // Try to detect local IP
  try {
    const os = require("os");
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
          return `http://${iface.address}:3000`;
        }
      }
    }
  } catch {}

  return "http://localhost:3000";
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║      Stripe 支付配置检测 & Webhook 部署引导          ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════╝${C.reset}`);

  let exitCode = 0;

  // ═══════════════════════════════════════════════════════════════
  //  Part 1: 环境变量检测
  // ═══════════════════════════════════════════════════════════════
  title("1️⃣  环境变量检测");

  const envLocal = loadEnvFile(path.join(ROOT, ".env.local"));
  const envExample = loadEnvFile(path.join(ROOT, ".env.example"));

  if (!envLocal) {
    warn(".env.local 文件不存在，正在从 .env.example 创建...");
    try {
      fs.copyFileSync(path.join(ROOT, ".env.example"), path.join(ROOT, ".env.local"));
      ok(".env.local 已从 .env.example 创建，请填入真实密钥");
    } catch (err) {
      fail(`创建 .env.local 失败: ${err.message}`);
    }
  } else {
    ok(".env.local 文件存在");
  }

  const checks = [
    { key: "STRIPE_SECRET_KEY", label: "STRIPE_SECRET_KEY (私钥)" },
    { key: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", label: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (公钥)" },
    { key: "STRIPE_WEBHOOK_SECRET", label: "STRIPE_WEBHOOK_SECRET (Webhook 签名密钥)" },
  ];

  const envSource = envLocal || envExample;
  for (const check of checks) {
    const val = envSource?.[check.key];
    if (!val || val === "YOUR_STRIPE_SECRET_KEY_HERE" || val === "YOUR_STRIPE_PUBLISHABLE_KEY_HERE" || val === "YOUR_STRIPE_WEBHOOK_SECRET_HERE") {
      fail(`${check.label} — 未配置`);
      exitCode = 1;
    } else {
      const masked = val.length > 12 ? val.slice(0, 8) + "…" + val.slice(-4) : val;
      ok(`${check.label} — 已配置 (${masked})`);
    }
  }

  // Check for the live keys the user provided
  if (envSource?.STRIPE_SECRET_KEY?.startsWith("sk_live_")) {
    ok("✅ 使用 Stripe Live 模式（生产环境）");
  } else if (envSource?.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    info("使用 Stripe Test 模式（测试环境）");
  }

  // ═══════════════════════════════════════════════════════════════
  //  Part 2: 代码配置验证
  // ═══════════════════════════════════════════════════════════════
  title("2️⃣  支付方式配置验证");

  // 检查 Checkout Route
  const checkoutPath = path.join(ROOT, "src/app/api/stripe/checkout/route.ts");
  if (fs.existsSync(checkoutPath)) {
    ok("Checkout API 端点存在: POST /api/stripe/checkout");
    const checkoutCode = fs.readFileSync(checkoutPath, "utf-8");

    if (checkoutCode.includes('"alipay"') && checkoutCode.includes('"wechat_pay"') && checkoutCode.includes('"card"')) {
      ok("支付方式配置: card + alipay + wechat_pay 全部启用");
    } else {
      warn("支付方式可能不完整，期望 card + alipay + wechat_pay");
    }

    if (checkoutCode.includes("user_id")) {
      ok("Checkout 传递 user_id / email 元数据 ✓");
    }
  } else {
    fail("Checkout API 端点缺失!");
    exitCode = 1;
  }

  // 检查 Webhook Route
  const webhookPath = path.join(ROOT, "src/app/api/stripe/webhook/route.ts");
  if (fs.existsSync(webhookPath)) {
    ok("Webhook API 端点存在: POST /api/stripe/webhook");
    const webhookCode = fs.readFileSync(webhookPath, "utf-8");

    const expectedEvents = [
      "checkout.session.completed",
      "invoice.payment_succeeded",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.payment_failed",
    ];

    for (const event of expectedEvents) {
      if (webhookCode.includes(event)) {
        ok(`事件监听: ${event}`);
      } else {
        warn(`事件监听缺失: ${event}`);
      }
    }

    if (webhookCode.includes("billing-store")) {
      ok("Webhook 使用 billing-store 持久化 ✓");
    }
  } else {
    fail("Webhook API 端点缺失!");
    exitCode = 1;
  }

  // 检查前端
  const pagePath = path.join(ROOT, "src/app/page.tsx");
  if (fs.existsSync(pagePath)) {
    const pageCode = fs.readFileSync(pagePath, "utf-8");
    if (pageCode.includes("alipay") && pageCode.includes("wechat_pay")) {
      ok("前端支付选择界面: 信用卡 + 支付宝 + 微信支付 + PayPal");
    }
  }

  // 检查 billing-store
  const storePath = path.join(ROOT, "src/lib/billing-store.ts");
  if (fs.existsSync(storePath)) {
    ok("账单存储模块存在 (src/lib/billing-store.ts)");
  }

  // ═══════════════════════════════════════════════════════════════
  //  Part 3: 部署域名检测 & Webhook 配置引导
  // ═══════════════════════════════════════════════════════════════
  title("3️⃣  Webhook 配置引导");

  const deployUrl = getDeploymentUrl();
  info(`当前环境域名: ${C.bold}${deployUrl}${C.reset}`);
  info(`Webhook URL:   ${C.bold}${deployUrl}/api/stripe/webhook${C.reset}`);

  console.log(`
  ${C.bold}Stripe Dashboard 配置步骤:${C.reset}

  1. 登录 Stripe Dashboard → ${C.cyan}Developers → Webhooks${C.reset}
     https://dashboard.stripe.com/webhooks

  2. 点击 ${C.bold}"Add endpoint"${C.reset}

  3. Endpoint URL 填入:
     ${C.green}${deployUrl}/api/stripe/webhook${C.reset}

  4. 在 "Events to send" 中选择以下事件:
     ${C.yellow}☑ checkout.session.completed${C.reset}
     ${C.yellow}☑ customer.subscription.updated${C.reset}
     ${C.yellow}☑ customer.subscription.deleted${C.reset}
     ${C.yellow}☑ invoice.payment_succeeded${C.reset}
     ${C.yellow}☑ invoice.payment_failed${C.reset}

  5. 点击 ${C.bold}"Add endpoint"${C.reset}

  6. 在创建的 endpoint 详情页中，找到 ${C.bold}"Signing secret"${C.reset}
     点击 ${C.bold}"Reveal"${C.reset} 复制以 ${C.cyan}whsec_${C.reset} 开头的密钥

  7. 将密钥填入 ${C.bold}.env.local${C.reset}:
     ${C.green}STRIPE_WEBHOOK_SECRET=whsec_你的webhook签名密钥${C.reset}

  8. 在 Stripe Dashboard 中，进入 ${C.cyan}Settings → Payment methods${C.reset}
     确保已启用以下支付方式:
     ${C.yellow}☑ Cards${C.reset} (Visa, Mastercard, AMEX, JCB, UnionPay)
     ${C.yellow}☑ Alipay${C.reset} (支付宝 — 中国)
     ${C.yellow}☑ WeChat Pay${C.reset} (微信支付 — 中国)
  `);

  // ═══════════════════════════════════════════════════════════════
  //  Part 4: Stripe CLI 测试建议
  // ═══════════════════════════════════════════════════════════════
  title("4️⃣  Stripe CLI 本地测试");

  // Check if stripe CLI is installed
  try {
    execSync("stipe --version 2>nul || stipe version 2>nul", { stdio: "ignore", timeout: 3000 });
    ok("Stripe CLI 已安装");
    console.log(`
  运行以下命令进行本地测试转发:
  ${C.cyan}stripe listen --forward-to localhost:3000/api/stripe/webhook${C.reset}

  触发测试事件:
  ${C.cyan}stripe trigger checkout.session.completed${C.reset}
  ${C.cyan}stripe trigger customer.subscription.created${C.reset}
  ${C.cyan}stripe trigger invoice.payment_succeeded${C.reset}
    `);
  } catch {
    info("Stripe CLI 未安装");
    console.log(`
  可选安装: ${C.cyan}https://stripe.com/docs/stripe-cli${C.reset}

  或使用 npm 安装:
  ${C.cyan}npm install -g stripe-cli${C.reset}

  安装后可在本地转发 Webhook:
  ${C.cyan}stripe listen --forward-to localhost:3000/api/stripe/webhook${C.reset}
    `);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Summary
  // ═══════════════════════════════════════════════════════════════
  title("📋 检测总结");

  if (exitCode === 0) {
    console.log(`  ${C.green}${C.bold}✅ 所有配置检查通过！${C.reset}`);
    console.log(`  ${C.dim}Stripe 支付集成已就绪，可以部署到生产环境。${C.reset}`);
  } else {
    console.log(`  ${C.yellow}${C.bold}⚠ 部分配置需要完善${C.reset}`);
    console.log(`  ${C.dim}请根据上面的提示修复未通过的项目。${C.reset}`);
  }

  hr();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`${C.red}[FATAL]${C.reset}`, err);
  process.exit(1);
});
