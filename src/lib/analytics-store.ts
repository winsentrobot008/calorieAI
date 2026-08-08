/**
 * analytics-store — 访问量与 IP 流量统计（JSON 文件持久化）
 */

import fs from "fs";
import path from "path";

export interface VisitRecord {
  ip: string;
  ua: string;
  path: string;
  ts: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "visits.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readVisits(): VisitRecord[] {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      return Array.isArray(data.visits) ? data.visits : [];
    }
  } catch (err) {
    console.error("[AnalyticsStore] Error reading store:", err);
  }
  return [];
}

function writeVisits(visits: VisitRecord[]): void {
  ensureDataDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ visits }, null, 2), "utf-8");
  } catch (err) {
    console.error("[AnalyticsStore] Error writing store:", err);
  }
}

/** 记录一次页面访问（上限 2000 条，滚动保留最近） */
export function recordVisit(entry: { ip: string; ua: string; path: string }): void {
  const visits = readVisits();
  visits.push({ ...entry, ts: new Date().toISOString() });
  if (visits.length > 2000) visits.splice(0, visits.length - 2000);
  writeVisits(visits);
}

/** 访问统计：总量 / 今日 / 独立 IP / 最近 IP 聚合 / 最近访问 */
export function getVisitStats(): {
  total_visits: number;
  today_visits: number;
  unique_ips: number;
  recent_ips: { ip: string; count: number; last_seen: string }[];
  recent_visits: VisitRecord[];
} {
  const visits = readVisits();
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);

  const today = visits.filter((v) => v.ts.slice(0, 10) === todayKey).length;

  const byIp = new Map<string, { count: number; last_seen: string }>();
  for (const v of visits) {
    const cur = byIp.get(v.ip) || { count: 0, last_seen: v.ts };
    cur.count += 1;
    if (v.ts > cur.last_seen) cur.last_seen = v.ts;
    byIp.set(v.ip, cur);
  }

  const recentIps = Array.from(byIp.entries())
    .map(([ip, info]) => ({ ip, ...info }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    total_visits: visits.length,
    today_visits: today,
    unique_ips: byIp.size,
    recent_ips: recentIps,
    recent_visits: visits.slice(-20).reverse(),
  };
}
