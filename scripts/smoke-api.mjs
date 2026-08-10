#!/usr/bin/env node
/**
 * smoke-api.mjs — 动态 API 冒烟测试 (交付前自检: 0 Error / 0 404)
 *
 * 自动发现 src/app/api 下所有路由 → 启动服务 (优先 next start, 否则 next dev)
 * → 逐个请求 → 断言没有任何 404 与连接错误 (404 之外的 4xx/5xx 证明路由存在, 仅记录)。
 *
 * 用法:
 *   npm run build                  # 先构建
 *   npm run test:api               # 用生产 next start 冒烟 (推荐, 最接近线上)
 *   node scripts/smoke-api.mjs --dev   # 强制用 next dev
 *   PORT=3200 node scripts/smoke-api.mjs
 */
import { spawn } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const apiDir = join(rootDir, "src", "app", "api");
const PORT = Number(process.env.PORT || 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const READY_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;
const SKIP = new Set(["node_modules", ".next", "dist", "build", "out", "data"]);
const FORCE_DEV = process.argv.includes("--dev");
const hasBuild = existsSync(join(rootDir, ".next", "BUILD_ID"));

// ── 语义级校验（动态语义断言，禁止仅断言 200 OK）───────────────────────
// 用 QA_SEMANTIC=0 可临时跳过（不推荐，交付门禁默认开启）。
const SEMANTIC = process.env.QA_SEMANTIC !== "0";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 旧硬编码桩的 Mock 签名（白米饭/鸡胸肉/西兰花固定三元组）——命中即判失败 */
const LEGACY_MOCK_TEXT_RECORDS = ["白米饭|200|260", "鸡胸肉|150|247", "西兰花|100|34"];
const LEGACY_MOCK_IMAGE_RECORDS = ["白米饭|200|260", "鸡胸肉|150|247", "西兰花|100|34"];

function recordSignature(records = []) {
  return records
    .map((r) => `${String(r?.food || "")}|${Number(r?.grams) || 0}|${Number(r?.calories) || 0}`)
    .join("~");
}

function isLegacyMock(records = []) {
  const sig = recordSignature(records);
  return sig === LEGACY_MOCK_TEXT_RECORDS.join("~") || sig === LEGACY_MOCK_IMAGE_RECORDS.join("~");
}

const randomOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => min + Math.floor(Math.random() * (max - min));

async function semanticProbes() {
  const probes = [];
  const push = (name, ok, detail) => probes.push({ name, ok, detail });

  // ── 1) analyze-text：随机输入 ×2，断言 200 + 模型标记 + 动态变更 + 非 Mock ──
  const textA = `吃了${rand(120, 220)}g米饭和${rand(60, 140)}g西兰花（QA语义随机 ${Date.now()}）`;
  const textB = `早餐${randomOf(["一杯牛奶", "两个鸡蛋", "一碗燕麦", "一份水果沙拉"])}（QA语义随机 ${Date.now()}）`;
  const textPayloads = [];
  for (const [idx, input] of [textA, textB].entries()) {
    try {
      const res = await fetch(`${BASE}/api/v1/meals/analyze-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": BROWSER_UA },
        body: JSON.stringify({ text: input, meal_type: "lunch" }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json().catch(() => ({}));
      const records = data?.records || [];
      const ok =
        res.status === 200 &&
        typeof data?.model?.provider === "string" &&
        Array.isArray(records) &&
        records.length > 0 &&
        !isLegacyMock(records);
      textPayloads.push({ records, raw: data });
      push(
        `analyze-text 语义[${idx + 1}]`,
        ok,
        `status=${res.status} provider=${data?.model?.provider || "-"} count=${records.length || 0}`
      );
    } catch (e) {
      push(`analyze-text 语义[${idx + 1}]`, false, `ERROR: ${e.message}`);
    }
  }
  if (textPayloads.length === 2) {
    const diff = recordSignature(textPayloads[0].records) !== recordSignature(textPayloads[1].records);
    push(
      "analyze-text 动态变更（两次随机输入结果不同）",
      diff,
      diff ? "records 签名不同" : "两次返回相同 records（疑似静态数据）"
    );
  }

  // ── 2) analyze-image：极小 PNG，断言非 Mock；成功需模型标记，失败需可诊断 code ──
  try {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const fd = new FormData();
    fd.append("file", new Blob([png], { type: "image/png" }), "qa-semantic.png");
    fd.append("meal_type", "lunch");
    const res = await fetch(`${BASE}/api/v1/meals/analyze-image`, {
      method: "POST",
      headers: { "User-Agent": BROWSER_UA },
      body: fd,
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json().catch(() => ({}));
    const records = data?.records || [];
    const notMock = !isLegacyMock(records);
    const hasModel = res.status === 200 && typeof data?.model?.provider === "string";
    const hasDiagCode = res.status !== 200 && typeof data?.code === "string";
    push(
      "analyze-image 语义（反 Mock + 模型标记/可诊断错误）",
      notMock && (hasModel || hasDiagCode),
      `status=${res.status} provider=${data?.model?.provider || "-"} code=${data?.code || "-"} count=${records.length || 0}`
    );
  } catch (e) {
    push("analyze-image 语义", false, `ERROR: ${e.message}`);
  }

  return probes;
}

/** Discover route handler base paths, e.g. "/api/v1/billing/status". */
function collect(base, dir) {
  const routes = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) routes.push(...collect(base + "/" + entry, p));
    else if (/^route\.(ts|js|mjs)$/.test(entry)) routes.push(base);
  }
  return routes;
}

// Normalize dynamic segments ([provider] → x) so the URL is directly requestable.
const routes = collect("/api", apiDir)
  .map((r) => r.replace(/\/\[[^\]]+\]/g, "/x"))
  .sort();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    try {
      const res = await fetch(BASE + "/", { signal: AbortSignal.timeout(5000) });
      if (res.status > 0) return true;
    } catch {
      /* server not up yet */
    }
    await delay(2000);
  }
  return false;
}

function killChild(child) {
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  if (process.platform === "win32" && child.pid) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    } catch {
      /* ignore */
    }
  }
}

/** Windows 兜底: 结束仍监听 PORT 的残留进程 (防止 next start 泄漏). */
function killPort(port) {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve();
    try {
      const ps = spawn("netstat", ["-ano"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      ps.stdout.on("data", (d) => (out += d.toString()));
      ps.on("close", () => {
        const pids = new Set();
        for (const line of out.split("\n")) {
          if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (/^\d+$/.test(pid)) pids.add(pid);
          }
        }
        for (const pid of pids) {
          try {
            spawn("taskkill", ["/PID", pid, "/T", "/F"]);
          } catch {
            /* ignore */
          }
        }
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function main() {
  if (routes.length === 0) {
    console.error("❌ smoke-api: no routes discovered under src/app/api");
    process.exit(1);
  }
  const mode = FORCE_DEV || !hasBuild ? "dev" : "start";
  console.log(`[smoke-api] mode=next ${mode}  port=${PORT}  routes=${routes.length}`);

  const command = `npm run ${mode} -- -p ${PORT} -H 127.0.0.1`;
  const child = spawn(command, {
    cwd: rootDir,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout.on("data", (d) => (serverLog += d.toString()));
  child.stderr.on("data", (d) => (serverLog += d.toString()));

  try {
    const ready = await waitReady();
    if (!ready) throw new Error("server did not become ready within timeout");
    console.log("✅ server ready");

    const results = [];
    const failures = [];
    for (const route of routes) {
      try {
        const res = await fetch(BASE + route, { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        results.push({ route, status: res.status });
        if (res.status === 404) failures.push(`${route} → 404`);
      } catch (e) {
        failures.push(`${route} → ERROR: ${e.message}`);
      }
    }

    console.log(`\n── API 冒烟结果 (${results.length} routes) ──`);
    for (const r of results) {
      const mark = r.status === 404 ? "❌" : r.status < 500 ? "✅" : "⚠️";
      console.log(`  ${mark} ${String(r.status).padStart(3)}  ${r.route}`);
    }

    // ── 语义级校验：动态输入 + 反 Mock 断言（失败即整体 FAIL）──
    let semanticFailures = [];
    if (SEMANTIC) {
      console.log("\n── 语义级校验（动态输入 / 反 Mock）──");
      const probes = await semanticProbes();
      for (const p of probes) {
        console.log(`  ${p.ok ? "✅" : "❌"} ${p.name} :: ${p.detail}`);
        if (!p.ok) semanticFailures.push(p.name);
      }
    } else {
      console.log("\n⚠️ QA_SEMANTIC=0：已跳过语义级校验（不推荐）");
    }

    const allFailures = [...failures, ...semanticFailures.map((n) => `语义校验失败: ${n}`)];
    if (allFailures.length) {
      console.error(`\n❌ smoke-api FAILED (${allFailures.length}):`);
      for (const f of allFailures) console.error(`   - ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`\n✅ smoke-api PASSED — 0 404, 0 errors, 语义校验 ${SEMANTIC ? "全过" : "已跳过"} (${results.length} routes)`);
    }
  } catch (e) {
    console.error(`❌ smoke-api FAILED: ${e.message}`);
    process.exitCode = 1;
  } finally {
    killChild(child);
    await killPort(PORT);
    if (process.exitCode !== 0) {
      console.log("\n── server log (tail) ──");
      console.log(serverLog.slice(-2000));
    }
  }
}

main();
