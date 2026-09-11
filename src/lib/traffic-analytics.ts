/**
 * traffic-analytics — 每日请求分类统计（Upstash / Vercel KV + 进程内降级）
 *
 * 按 UTC 日期（YYYY-MM-DD，与识图日志 / 访客日志口径一致）记录：
 *   - text          文本分析量（analyze-text 通过闸门进入分析）
 *   - image         识图分析量（analyze-image 通过闸门进入分析）
 *   - blocked_429   429 拦截量（限流 / 每日上限 / 测试期限额）
 *   - unique_visitors 独立访客（IP 数，任意事件都会登记）
 *
 * 存储结构（Redis，键按日切分并设置 TTL 自动过期）：
 *   calorieai:traffic:{date}:text|image|blocked  → INCR 计数
 *   calorieai:traffic:{date}:ips                 → SADD 独立 IP 集合
 *
 * 打点失败绝不抛错：统计属于旁路观测，不能影响 AI 识别主流程。
 */

import { getUpstashRestConfig } from "@commercial-engine/middleware/rate-limit";

export type TrafficEventType = "text" | "image" | "blocked" | "visit";

export interface DailyTrafficPoint {
  /** UTC 日期 YYYY-MM-DD */
  date: string;
  /** 文本分析量 */
  text: number;
  /** 识图分析量 */
  image: number;
  /** 429 拦截量 */
  blocked_429: number;
  /** 独立访客（IP）数 */
  unique_visitors: number;
}

/** 单次 Redis 往返超时：超时即降级，绝不拖慢请求 */
const REDIS_TIMEOUT_MS = 1_000;
/** 每日键保留天数（足够覆盖 30 天图表 + 冗余） */
const RETENTION_SECONDS = 90 * 24 * 60 * 60;
/** 默认查询窗口 */
export const TRAFFIC_DEFAULT_DAYS = 7;
/** 允许的查询窗口（7 天 / 30 天） */
export const TRAFFIC_ALLOWED_DAYS = [7, 30];
/** 最多返回的天数（防御性上限） */
const MAX_DAYS = 90;

const PREFIX = "calorieai:traffic";

interface MemoryDay {
  text: number;
  image: number;
  blocked: number;
  ips: Set<string>;
}

/** 进程内降级存储（未配置 KV 或 Redis 异常时启用） */
const memoryDays = new Map<string, MemoryDay>();

/** 事件类型 → Redis 计数字段（visit 只登记访客，不计入请求分类） */
const EVENT_FIELD: Record<TrafficEventType, "text" | "image" | "blocked" | null> = {
  text: "text",
  image: "image",
  blocked: "blocked",
  visit: null,
};

/** UTC 日期键（与 vision/visit 日志的 ts.slice(0, 10) 对齐） */
export function trafficDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function counterKey(date: string, field: string): string {
  return `${PREFIX}:${date}:${field}`;
}

function ipsKey(date: string): string {
  return `${PREFIX}:${date}:ips`;
}

function memoryDay(date: string): MemoryDay {
  let day = memoryDays.get(date);
  if (!day) {
    day = { text: 0, image: 0, blocked: 0, ips: new Set<string>() };
    memoryDays.set(date, day);
    if (memoryDays.size > MAX_DAYS + 30) {
      for (const key of Array.from(memoryDays.keys()).sort()) {
        if (memoryDays.size <= MAX_DAYS) break;
        memoryDays.delete(key);
      }
    }
  }
  return day;
}

/** 调用 Upstash REST pipeline（单次往返批量执行，失败返回 null） */
async function callPipeline(
  url: string,
  token: string,
  commands: (string | number)[][]
): Promise<any[] | null> {
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data: any = await res.json().catch(() => null);
  return Array.isArray(data) ? data : null;
}

function toCount(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : 0;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * 记录一次请求分类事件（best-effort）：
 *   - text / image → 对应分析量 +1；
 *   - blocked     → 429 拦截量 +1；
 *   - visit       → 仅登记独立访客 IP（页面访问上报）。
 * ip 存在时始终登记独立访客集合。
 */
export async function recordTrafficEvent(type: TrafficEventType, ip?: string): Promise<void> {
  const date = trafficDateKey();
  const field = EVENT_FIELD[type];
  const visitor = (ip || "").trim();

  // 进程内镜像：无论 Redis 是否可用都计数，作为降级读数与兜底
  const day = memoryDay(date);
  if (field) day[field] += 1;
  if (visitor && visitor !== "unknown") day.ips.add(visitor);

  const cfg = getUpstashRestConfig();
  if (!cfg) return;
  try {
    const commands: (string | number)[][] = [];
    if (field) {
      const key = counterKey(date, field);
      commands.push(["INCR", key], ["EXPIRE", key, RETENTION_SECONDS]);
    }
    if (visitor && visitor !== "unknown") {
      commands.push(["SADD", ipsKey(date), visitor], ["EXPIRE", ipsKey(date), RETENTION_SECONDS]);
    }
    if (!commands.length) return;
    await callPipeline(cfg.url, cfg.token, commands);
  } catch (err: unknown) {
    console.warn(
      "[traffic-analytics] Redis 打点失败，仅进程内计数:",
      err instanceof Error ? err.message : err
    );
  }
}

/** 生成最近 N 天的 UTC 日期序列（升序，含今天） */
function recentDates(days: number): string[] {
  const count = Math.max(1, Math.min(MAX_DAYS, Math.floor(days) || TRAFFIC_DEFAULT_DAYS));
  const dates: string[] = [];
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    dates.push(trafficDateKey(new Date(now - i * 24 * 60 * 60 * 1000)));
  }
  return dates;
}

/**
 * 读取最近 N 天的每日分类统计（升序，缺失日期补 0）。
 * Redis 可用时单次 pipeline 取回全部日期；不可用时回退进程内计数。
 */
export async function getTrafficSeries(days: number = TRAFFIC_DEFAULT_DAYS): Promise<DailyTrafficPoint[]> {
  const dates = recentDates(days);
  const cfg = getUpstashRestConfig();
  if (cfg) {
    try {
      const commands: (string | number)[][] = [];
      for (const date of dates) {
        commands.push(
          ["GET", counterKey(date, "text")],
          ["GET", counterKey(date, "image")],
          ["GET", counterKey(date, "blocked")],
          ["SCARD", ipsKey(date)]
        );
      }
      const results = await callPipeline(cfg.url, cfg.token, commands);
      if (results) {
        return dates.map((date, i) => {
          const base = i * 4;
          return {
            date,
            text: toCount(results[base]?.result),
            image: toCount(results[base + 1]?.result),
            blocked_429: toCount(results[base + 2]?.result),
            unique_visitors: toCount(results[base + 3]?.result),
          };
        });
      }
    } catch (err: unknown) {
      console.warn(
        "[traffic-analytics] Redis 读取失败，回退进程内统计:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return dates.map((date) => {
    const day = memoryDays.get(date);
    return {
      date,
      text: day?.text ?? 0,
      image: day?.image ?? 0,
      blocked_429: day?.blocked ?? 0,
      unique_visitors: day?.ips.size ?? 0,
    };
  });
}
