/**
 * check-token-guard.mjs — 付费 API 自动节省 Token 模式自检
 *
 * 直接加载 commercial-engine 的权威策略（TS 现场转译，零构建依赖），
 * 对「云端付费」与「本地豁免」两类目标逐项断言并打印控制台日志：
 *   - 云端付费：max_tokens=1000 / temperature=0.2 / Vision detail=low +
 *     分辨率上限 1024px / System Prompt 已挂载极简强约束；
 *   - 本地服务（ollama 或 BASE_URL 含 localhost / 127.0.0.1）：
 *     彻底绕过压缩，不设 max_tokens、不改 detail、不注入 System Prompt。
 *
 * 用法：node scripts/check-token-guard.mjs
 * 退出码：0 = 全部通过；1 = 存在断言失败。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const guardPath = path.resolve(
  here,
  "../src/lib/commercial-engine/middleware/llm-token-guard.ts"
);

const source = fs.readFileSync(guardPath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

const tmpFile = path.join(os.tmpdir(), `llm-token-guard-${process.pid}.mjs`);
fs.writeFileSync(tmpFile, compiled, "utf8");
const guard = await import(pathToFileURL(tmpFile).href);
fs.rmSync(tmpFile, { force: true });

const CLOUD = [
  ["gemini", "https://generativelanguage.googleapis.com"],
  ["deepseek", "https://api.deepseek.com"],
  ["openai", "https://api.openai.com/v1"],
  ["replicate", "https://api.replicate.com"],
  ["siliconflow", "https://api.siliconflow.cn"],
  ["openrouter", "https://openrouter.ai/api/v1"],
];

const LOCAL = [
  ["ollama", "http://localhost:11434"],
  ["openai", "http://127.0.0.1:8000/v1"],
];

const BASE_PROMPT = "You are a nutrition assistant.";
let failures = 0;

function check(label, condition, actual) {
  if (condition) {
    console.log(`  ✅ ${label}`);
  } else {
    failures += 1;
    console.log(`  ❌ ${label} → actual: ${JSON.stringify(actual)}`);
  }
}

console.log("=== 云端付费 Provider：强制压缩 ===");
for (const [provider, baseUrl] of CLOUD) {
  const policy = guard.resolveTokenPolicy({ provider, baseUrl });
  const openaiBody = guard.enforceOpenAiParams(
    { model: "x", messages: [{ role: "user", content: "hi" }] },
    policy
  );
  const geminiConfig = guard.enforceGeminiConfig(
    { responseMimeType: "application/json" },
    policy,
    { vision: true }
  );
  const systemPrompt = guard.appendConciseSystemPrompt(BASE_PROMPT, policy);
  const vision = guard.visionEnforcement(policy);

  console.log(guard.describePolicy(policy));
  check("max_tokens = 1000", openaiBody.max_tokens === 1000, openaiBody.max_tokens);
  check("temperature = 0.2", openaiBody.temperature === 0.2, openaiBody.temperature);
  check("vision detail = low", vision.detail === "low", vision.detail);
  check("vision maxEdge = 1024px", vision.maxEdgePx === 1024, vision.maxEdgePx);
  check("gemini maxOutputTokens = 1000", geminiConfig.maxOutputTokens === 1000, geminiConfig.maxOutputTokens);
  check(
    "gemini mediaResolution = LOW",
    geminiConfig.mediaResolution === "MEDIA_RESOLUTION_LOW",
    geminiConfig.mediaResolution
  );
  check(
    "system prompt 已挂载极简指令",
    systemPrompt.includes(guard.CONCISE_SYSTEM_SUFFIX),
    systemPrompt
  );
}

console.log("\n=== 本地服务：彻底豁免（全量放开） ===");
for (const [provider, baseUrl] of LOCAL) {
  const policy = guard.resolveTokenPolicy({ provider, baseUrl });
  const openaiBody = guard.enforceOpenAiParams({ model: "x", messages: [] }, policy);
  const geminiConfig = guard.enforceGeminiConfig(
    { responseMimeType: "application/json" },
    policy,
    { vision: true }
  );
  const systemPrompt = guard.appendConciseSystemPrompt(BASE_PROMPT, policy);
  const vision = guard.visionEnforcement(policy);

  console.log(guard.describePolicy(policy));
  check("未注入 max_tokens（保持模型上限）", openaiBody.max_tokens === undefined, openaiBody.max_tokens);
  check("未改写 temperature", openaiBody.temperature === undefined, openaiBody.temperature);
  check("未强制 detail", vision.detail === null, vision.detail);
  check("未限制分辨率", vision.maxEdgePx === null, vision.maxEdgePx);
  check("gemini 未注入 maxOutputTokens", geminiConfig.maxOutputTokens === undefined, geminiConfig.maxOutputTokens);
  check("system prompt 原样保留", systemPrompt === BASE_PROMPT, systemPrompt);
}

console.log(
  failures === 0
    ? "\n✅ token-guard 自检全部通过（云端压缩 + 本地豁免）"
    : `\n❌ token-guard 自检失败 ${failures} 项`
);
process.exit(failures === 0 ? 0 : 1);
