/**
 * vision-log-store — AI 识图运行日志（JSON 文件持久化）
 * 记录每次识图请求：命中提供商/模型、耗时、状态码（200/400/429/502/503）与错误原因。
 */

import fs from "fs";
import path from "path";

export interface VisionLogEntry {
  ts: string;
  ip: string;
  provider: string;
  model?: string;
  label?: string;
  status: number;
  latency_ms: number;
  count?: number;
  error?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "vision_logs.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readLogs(): VisionLogEntry[] {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      return Array.isArray(data.logs) ? data.logs : [];
    }
  } catch (err) {
    console.error("[VisionLogStore] Error reading store:", err);
  }
  return [];
}

function writeLogs(logs: VisionLogEntry[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ logs }, null, 2), "utf-8");
  } catch (err) {
    console.error("[VisionLogStore] Error writing store:", err);
  }
}

/** 记录一条识图日志（上限 500 条，滚动保留最近） */
export function recordVisionLog(entry: Omit<VisionLogEntry, "ts">): void {
  const logs = readLogs();
  logs.push({ ...entry, ts: new Date().toISOString() });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  writeLogs(logs);
}

/** 获取最近 N 条识图日志（最新在前） */
export function getVisionLogs(limit = 100): VisionLogEntry[] {
  return readLogs().slice(-limit).reverse();
}

/** 识图聚合统计：总调用 / 今日 / 错误率 / 按提供商与模型聚合 */
export function getVisionStats(): {
  total_calls: number;
  today_calls: number;
  errors: number;
  error_rate_pct: number;
  by_provider: {
    name: string;
    model?: string;
    calls: number;
    errors: number;
    avg_latency_ms: number;
  }[];
} {
  const logs = readLogs();
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayCalls = logs.filter((l) => l.ts.slice(0, 10) === todayKey).length;
  const errors = logs.filter((l) => l.status >= 400).length;

  const byKey = new Map<string, { name: string; model?: string; calls: number; errors: number; latencyTotal: number }>();
  for (const l of logs) {
    const key = `${l.provider}|${l.model || ""}`;
    const cur = byKey.get(key) || { name: l.provider, model: l.model, calls: 0, errors: 0, latencyTotal: 0 };
    cur.calls += 1;
    if (l.status >= 400) cur.errors += 1;
    cur.latencyTotal += l.latency_ms;
    byKey.set(key, cur);
  }

  return {
    total_calls: logs.length,
    today_calls: todayCalls,
    errors,
    error_rate_pct: logs.length ? Math.round((errors / logs.length) * 1000) / 10 : 0,
    by_provider: Array.from(byKey.values()).map((v) => ({
      name: v.name,
      model: v.model,
      calls: v.calls,
      errors: v.errors,
      avg_latency_ms: v.calls ? Math.round(v.latencyTotal / v.calls) : 0,
    })),
  };
}
