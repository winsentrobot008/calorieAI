/**
 * feature-flags — 动态功能开关（Upstash / Vercel KV 实时存储 + 进程内降级）
 *
 * 与 anti-crawler / trial-quota 保持一致的存储策略：
 *   1. 配置 KV_REST_API_* / VERCEL_KV_REST_API_* / UPSTASH_REDIS_REST_* 时，
 *      开关值读写 Redis（多实例一致，管理员改一次全站生效）；
 *   2. 未配置或 Redis 异常 → 回退进程内 Map（best-effort，单实例）。
 *
 * 读路径必须“绝不抛错”：开关是请求前置闸门，Redis 抖动时按默认值降级，
 * 不能因为开关存储不可用而拖垮 AI 识别主流程。
 */

import { getUpstashRestConfig } from "@git008/commercial-engine/middleware/rate-limit";

/** 功能开关键名（Redis 中统一存放在 calorieai:feature-flags 哈希） */
export const FEATURE_VISION_ENABLED = "FEATURE_VISION_ENABLED";

export type FeatureFlagKey = typeof FEATURE_VISION_ENABLED;

/**
 * 开关元数据：默认值 + 用途说明。
 *
 * 测试期默认值为 true（放行）：开关是请求前置闸门，未配置 KV、Redis 抖动
 * 超时、或哈希字段尚未写入时一律按默认值降级。默认 false 会导致「管理后台
 * 刚打开开关，普通用户仍被 403 拦截」——管理后台的写入只落在当前实例的
 * 进程内 Map，其他 Serverless 实例读不到，只能各自回退到默认值。
 * 关闭动作应由管理员显式写 KV 覆盖默认值，而不是依赖默认值本身拦截。
 */
export const FEATURE_FLAG_DEFINITIONS: Record<
  FeatureFlagKey,
  { label: string; description: string; defaultEnabled: boolean }
> = {
  [FEATURE_VISION_ENABLED]: {
    label: "普通用户 AI 识图开关",
    description: "关闭后普通用户调用识图接口返回 403，管理员始终豁免（当前默认开启）",
    defaultEnabled: true,
  },
};

/** 识图开关关闭时返回给普通用户的提示文案（按要求逐字返回） */
export const VISION_DISABLED_MESSAGE = "测试阶段普通用户 AI 识图暂未开放，请使用文字输入分析";
/** 识图开关关闭时的错误码（HTTP 403） */
export const VISION_DISABLED_CODE = "VISION_DISABLED";

/** 全部开关键 */
export const FEATURE_FLAG_KEYS: FeatureFlagKey[] = [FEATURE_VISION_ENABLED];

/** Redis key：所有开关存放在同一哈希，避免键数量膨胀 */
const REDIS_KEY = "calorieai:feature-flags";
/** 单次 Redis 往返超时：超时即降级，绝不拖慢请求 */
const REDIS_TIMEOUT_MS = 1_000;

/** 进程内降级存储（未配置 KV 或 Redis 异常时启用） */
const memoryFlags = new Map<FeatureFlagKey, boolean>();

export interface FeatureFlagState {
  key: FeatureFlagKey;
  enabled: boolean;
  default_enabled: boolean;
  label: string;
  description: string;
}

function defaultValue(key: FeatureFlagKey): boolean {
  return FEATURE_FLAG_DEFINITIONS[key]?.defaultEnabled ?? false;
}

function memoryValue(key: FeatureFlagKey): boolean {
  return memoryFlags.has(key) ? Boolean(memoryFlags.get(key)) : defaultValue(key);
}

/** 解析 Redis 返回值（"1"/"0"/"true"/"false"） */
function parseStoredFlag(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

/** 读取单个开关：Redis 哈希字段 → 进程内 → 默认值（测试期默认 true，放行） */
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  const cfg = getUpstashRestConfig();
  if (cfg) {
    try {
      const res = await fetch(`${cfg.url}/hget/${encodeURIComponent(REDIS_KEY)}/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      });
      const data: any = await res.json().catch(() => null);
      const parsed = parseStoredFlag(data?.result);
      if (parsed !== null) return parsed;
      return defaultValue(key);
    } catch (err: unknown) {
      console.warn(
        "[feature-flags] Redis 读取失败，按默认值降级（不阻断主流程）:",
        err instanceof Error ? err.message : err
      );
    }
  } else {
    // 未配置 KV：管理后台的切换只对当前实例生效，不会跨实例传播。
    console.warn(
      `[feature-flags] 未配置 KV_REST_API_* / UPSTASH_REDIS_REST_*，开关 ${key} 按默认值（${defaultValue(
        key
      )}）降级，管理后台切换不会跨实例生效`
    );
  }
  return memoryValue(key);
}

/** 读取全部开关状态（供管理后台配置中心展示） */
export async function getFeatureFlags(): Promise<FeatureFlagState[]> {
  return Promise.all(
    FEATURE_FLAG_KEYS.map(async (key) => ({
      key,
      enabled: await isFeatureEnabled(key),
      default_enabled: defaultValue(key),
      label: FEATURE_FLAG_DEFINITIONS[key].label,
      description: FEATURE_FLAG_DEFINITIONS[key].description,
    }))
  );
}

/**
 * 写入单个开关（管理员动态切换）：
 *   - Redis 可用 → 写哈希字段（并续期，避免冷 key 堆积）；
 *   - Redis 不可用 → 写进程内 Map，保证当前实例立即生效。
 */
export async function setFeatureEnabled(key: FeatureFlagKey, enabled: boolean): Promise<boolean> {
  const value = enabled ? "1" : "0";
  const cfg = getUpstashRestConfig();
  memoryFlags.set(key, enabled);
  if (cfg) {
    try {
      await fetch(`${cfg.url}/hset/${encodeURIComponent(REDIS_KEY)}/${encodeURIComponent(key)}/${value}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      });
      await fetch(`${cfg.url}/expire/${encodeURIComponent(REDIS_KEY)}/${365 * 24 * 60 * 60}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
      }).catch(() => undefined);
    } catch (err: unknown) {
      console.warn(
        "[feature-flags] Redis 写入失败，仅进程内生效:",
        err instanceof Error ? err.message : err
      );
    }
  }
  return enabled;
}

/** 将字符串解析为布尔（兼容 "1"/"0"/"true"/"false"/"on"/"off"） */
export function parseFlagInput(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const parsed = parseStoredFlag(value);
  if (parsed !== null) return parsed;
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "on" || raw === "yes") return true;
  if (raw === "off" || raw === "no") return false;
  return null;
}

/** 键名是否为受支持的开关 */
export function isFeatureFlagKey(key: string): key is FeatureFlagKey {
  return (FEATURE_FLAG_KEYS as string[]).includes(key);
}
