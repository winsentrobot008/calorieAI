/**
 * trial-quota — 测试期每日请求额度计数（普通用户 3 次 / 24h；管理员由调用方豁免）
 *
 * 存储优先级（与 anti-crawler 限流一致）：
 *   1. Upstash / Vercel KV（多实例一致；REST 命令直接调用）；
 *   2. 未配置或 Redis 异常 → 回退进程内 Map（best-effort，单实例）。
 *
 * 消费：ZADD（记时间戳）→ ZREMRANGEBYSCORE（清窗口外）→ ZCARD（计数）；
 * 退还：ZREMRANGEBYRANK(-1,-1) 移除最近一次（AI 调用失败时退次数）。
 */

import { getUpstashRestConfig } from "@git008/commercial-engine/middleware/rate-limit";

/** 24 小时滑动窗口（题述「每日 / 24 小时内」） */
export const TRIAL_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Redis key 前缀（与 anti-crawler 的 calorieai:rl:* 区分） */
const TRIAL_PREFIX = "calorieai:trial-daily";
/** 单次 Redis 往返超时：超时即回退进程内，绝不拖慢 AI 调用 */
const REDIS_TIMEOUT_MS = 1_000;

export interface TrialQuotaCheck {
  allowed: boolean;
  used: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface UpstashConfig {
  url: string;
  token: string;
}

/** 进程内回退计数（key → 时间戳数组，升序） */
const memoryBuckets = new Map<string, number[]>();

function memoryCheck(key: string, limit: number): TrialQuotaCheck {
  const now = Date.now();
  const recent = (memoryBuckets.get(key) || []).filter((ts) => now - ts < TRIAL_WINDOW_MS);
  if (recent.length >= limit) {
    memoryBuckets.set(key, recent);
    return {
      allowed: false,
      used: recent.length,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + TRIAL_WINDOW_MS - now) / 1000)),
    };
  }
  recent.push(now);
  memoryBuckets.set(key, recent);
  if (memoryBuckets.size > 5000) {
    for (const [k, v] of memoryBuckets) {
      if (!v.some((ts) => now - ts < TRIAL_WINDOW_MS)) memoryBuckets.delete(k);
    }
  }
  return {
    allowed: true,
    used: recent.length,
    remaining: Math.max(0, limit - recent.length),
    retryAfterSeconds: 0,
  };
}

/** 退还最近一次消费（进程内） */
function memoryRelease(key: string): void {
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.length === 0) return;
  bucket.pop();
}

function redisKey(key: string): string {
  return `${TRIAL_PREFIX}:${key}`;
}

/** 调用 Upstash REST 命令，返回 result（无结果时为 null） */
async function callRedis(
  cfg: UpstashConfig,
  command: string,
  method: "GET" | "POST" = "GET"
): Promise<unknown> {
  const res = await fetch(`${cfg.url}/${command}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}` },
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
  });
  const data: any = await res.json().catch(() => null);
  return data?.result ?? null;
}

async function upstashCheck(cfg: UpstashConfig, key: string, limit: number): Promise<TrialQuotaCheck> {
  const now = Date.now();
  const zkey = encodeURIComponent(redisKey(key));
  const member = encodeURIComponent(`${now}-${Math.random().toString(36).slice(2, 8)}`);
  const min = now - TRIAL_WINDOW_MS;

  await callRedis(cfg, `zadd/${zkey}/${now}/${member}`, "POST");
  await callRedis(cfg, `zremrangebyscore/${zkey}/${encodeURIComponent("-inf")}/${min}`, "POST");
  const used = Number(await callRedis(cfg, `zcard/${zkey}`)) || 0;
  await callRedis(cfg, `expire/${zkey}/${Math.ceil((TRIAL_WINDOW_MS * 2) / 1000)}`, "POST");

  if (used <= limit) {
    return { allowed: true, used, remaining: Math.max(0, limit - used), retryAfterSeconds: 0 };
  }

  let retryAfterSeconds = Math.ceil(TRIAL_WINDOW_MS / 1000);
  try {
    const head: any = await callRedis(cfg, `zrange/${zkey}/0/0/withscores`);
    const oldest = Array.isArray(head) ? Number(head[1]) : Number(head);
    if (Number.isFinite(oldest) && oldest > 0) {
      retryAfterSeconds = Math.max(1, Math.ceil((oldest + TRIAL_WINDOW_MS - now) / 1000));
    }
  } catch {
    /* 保留整窗口兜底值 */
  }
  return { allowed: false, used, remaining: 0, retryAfterSeconds };
}

/** 退还最近一次消费（Redis 有序集合最高分 = 最新时间戳） */
async function upstashRelease(cfg: UpstashConfig, key: string): Promise<void> {
  const zkey = encodeURIComponent(redisKey(key));
  await callRedis(cfg, `zremrangebyrank/${zkey}/-1/-1`, "POST");
  await callRedis(cfg, `expire/${zkey}/${Math.ceil((TRIAL_WINDOW_MS * 2) / 1000)}`, "POST");
}

/** 消费 1 次额度：allowed=false 表示已达上限（本次不计数） */
export async function consumeTrialQuota(key: string, limit: number): Promise<TrialQuotaCheck> {
  if (!key) return { allowed: true, used: 0, remaining: limit, retryAfterSeconds: 0 };
  const cfg = getUpstashRestConfig();
  if (cfg) {
    try {
      return await upstashCheck(cfg, key, limit);
    } catch (err: unknown) {
      console.warn(
        "[trial-quota] Redis 异常，回退进程内计数:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return memoryCheck(key, limit);
}

/** 退还 1 次额度（AI 调用失败时补偿，best-effort） */
export async function releaseTrialQuota(key: string): Promise<void> {
  if (!key) return;
  const cfg = getUpstashRestConfig();
  if (!cfg) {
    memoryRelease(key);
    return;
  }
  try {
    await upstashRelease(cfg, key);
  } catch (err: unknown) {
    console.warn(
      "[trial-quota] Redis 退次数失败:",
      err instanceof Error ? err.message : err
    );
  }
}
