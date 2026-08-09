#!/usr/bin/env node
/**
 * deploy-prod.mjs — 强制部署最新代码到 Vercel Production
 *
 * 用法（需先准备有效 VERCEL_TOKEN）:
 *   VERCEL_TOKEN=<token> npm run deploy:prod
 *   VERCEL_TOKEN=<token> VERCEL_PROJECT=calorie-ai npm run deploy:prod
 *
 * 流程：
 *   1. 预检 VERCEL_TOKEN（API /v2/user，无效立即失败，不挂起）；
 *   2. vercel link 关联项目（默认项目名 calorie-ai，可用 VERCEL_PROJECT 覆盖）；
 *   3. vercel --prod --force 强制部署本地最新产物到生产。
 */

const TOKEN = process.env.VERCEL_TOKEN || "";
const PROJECT = process.env.VERCEL_PROJECT || "calorie-ai";
const PLACEHOLDER = /^(your|xxx|replace)/i;

if (!TOKEN || PLACEHOLDER.test(TOKEN)) {
  console.error("❌ 缺少有效 VERCEL_TOKEN：请在 Vercel Dashboard → Account Settings → Tokens 创建后设置环境变量。");
  process.exit(1);
}

// ── 预检：token 无效直接退出（避免 CLI 挂起）──
const pre = await fetch("https://api.vercel.com/v2/user", {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
if (!pre.ok) {
  console.error(`❌ VERCEL_TOKEN 无效（API ${pre.status}）：已过期或已吊销，请重新生成后再试。`);
  process.exit(1);
}

import { spawnSync } from "node:child_process";

function v(...args) {
  console.log(`\n> vercel ${args.join(" ")}`);
  const r = spawnSync(
    "npx",
    ["--yes", "vercel", ...args, "--token", TOKEN, "--yes"],
    { stdio: "inherit", shell: process.platform === "win32" }
  );
  if (r.status !== 0) process.exitCode = r.status || 1;
  return r.status === 0;
}

if (!v("link", "--project", PROJECT, "--yes")) process.exit(1);
if (!v("--prod", "--force", "--yes")) process.exit(1);

console.log("\n✅ Production 部署已触发，可在 https://vercel.com/dashboard 查看进度。");
