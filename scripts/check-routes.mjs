#!/usr/bin/env node
/**
 * Route / API path quality gate — scripts/check-routes.mjs
 *
 * Scans the frontend sources (src/) for request URLs and fails the build when it finds:
 *   1. Duplicated "/api/api" prefix (a double-layer /api).
 *   2. "${API}/api/..." template-literal concatenation bugs (same root cause).
 *   3. Any "//" double-slash inside an API path.
 *   4. A literal "/api/..." path that has no matching route handler
 *      (expected at src/app/api<path>/route.ts) → would 404 at runtime.
 *
 * Usage:
 *   node scripts/check-routes.mjs     # exit 0 = ok, exit 1 = errors found
 *
 * Wired automatically via:
 *   npm run test:routes
 *   npm run build    (npm "prebuild" → test:routes)
 *   .githooks/pre-commit and .githooks/pre-push
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const SRC_DIR = join(rootDir, "src");
const API_ROUTES_DIR = join(SRC_DIR, "app", "api");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", "out", ".git", "coverage", "data"]);

const errors = [];
const checked = new Set();

/** Walk a directory, returning matching file paths (skipping heavy dirs). */
function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

/** Collect existing route-handler base paths, e.g. "/v1/meals/analyze-image". */
function collectRoutes(dir, base) {
  const routes = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) routes.push(...collectRoutes(p, base + "/" + entry));
    else if (/^route\.(ts|js|mjs)$/.test(entry)) routes.push(base);
  }
  return routes;
}

const existingRoutes = new Set(collectRoutes(API_ROUTES_DIR, ""));

function resolveTemplate(url) {
  return url.split("${API}").join("/api");
}

function checkUrl(rawUrl, file, line) {
  if (!rawUrl || checked.has(rawUrl)) return;
  checked.add(rawUrl);

  const resolved = resolveTemplate(rawUrl);

  // 1) duplicated /api/api (also catches `${API}/api/...`)
  if (/\/api\/api\b/.test(resolved)) {
    errors.push(`${file}:${line}  duplicated "/api/api" prefix → "${rawUrl}" (use "/api/v1/..." not "/api/api/v1/...")`);
    return;
  }
  // 2) double slash
  if (/\/\//.test(resolved)) {
    errors.push(`${file}:${line}  double slash "//" in URL → "${rawUrl}"`);
    return;
  }
  // 3) existence check — only for fully static /api paths
  if (!resolved.startsWith("/api")) return;
  if (resolved.includes("${")) return; // still dynamic → cannot verify statically
  const pathOnly = resolved.split("?")[0].split("#")[0];
  if (!pathOnly || pathOnly === "/api") return;
  const routeRel = pathOnly.replace(/\/+$/, "").replace(/^\/api/, "");
  if (!existingRoutes.has(routeRel)) {
    errors.push(`${file}:${line}  route handler not found for "${pathOnly}" (expected src/app/api${routeRel}/route.ts)`);
  }
}

let scannedFiles = 0;

// ── Scan frontend sources ─────────────────────────────────────────────
for (const file of walk(SRC_DIR, [".tsx", ".ts", ".mjs", ".js"])) {
  scannedFiles++;
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const rel = relative(rootDir, file);

    // (A) plain "/api..." string literals: "...", '...', `...`
    const directRe = /["'`](\/api[^"'`]*)/g;
    let m;
    while ((m = directRe.exec(line)) !== null) {
      checkUrl(m[1], rel, lineNo);
    }

    // (B) template literals starting with `${API}`: `${API}/v1/...`
    const templRe = /\$\{API\}\s*([^"'`\s]+)/g;
    while ((m = templRe.exec(line)) !== null) {
      checkUrl("/api" + m[1], rel, lineNo);
    }
  }
}

// ── Safety net: literal "/api/api" anywhere in the repo (incl. scripts) ─
for (const file of [...walk(rootDir, [".mjs", ".js", ".ts", ".tsx", ".json"])]) {
  if (file.endsWith("check-routes.mjs")) continue; // self-exclusion
  if (file.startsWith(join(rootDir, "node_modules"))) continue;
  const rel = relative(rootDir, file);
  const content = readFileSync(file, "utf8");
  if (/\/api\/api\b/.test(content)) {
    errors.push(`${rel}  contains literal "/api/api"`);
  }
}

// ── Report ────────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`\n❌ Route/API path check FAILED (${errors.length} issue(s) across ${scannedFiles} scanned files):\n`);
  for (const e of [...new Set(errors)]) console.error(`   - ${e}`);
  console.error(`\nFix the reported paths, then re-run:  npm run test:routes\n`);
  process.exit(1);
}

console.log(`✅ Route/API path check passed (${scannedFiles} files scanned, ${checked.size} URLs validated).`);
