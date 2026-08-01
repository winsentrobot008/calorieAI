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

    if (failures.length) {
      console.error(`\n❌ smoke-api FAILED (${failures.length}):`);
      for (const f of failures) console.error(`   - ${f}`);
      process.exitCode = 1;
    } else {
      console.log(`\n✅ smoke-api PASSED — 0 404, 0 errors across ${results.length} routes`);
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
