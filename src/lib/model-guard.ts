/**
 * model-guard — CalorieAI 付费 API 省钱适配层（商业引擎统一实现）
 *
 * 权威策略在 commercial-engine/middleware/llm-token-guard.ts：
 *   - 本地模型（LLM_PROVIDER=ollama 或 BASE_URL 含 localhost/127.0.0.1）→ 彻底豁免；
 *   - 云端付费 Provider（gemini/deepseek/openai/replicate/siliconflow/openrouter）
 *     → 强制 max_tokens=1000、temperature=0.2、Vision detail=low + 分辨率 ≤1024px、
 *       System Prompt 追加极简强约束。
 *
 * 本适配层负责三件引擎不该做的事（依赖注入，与 cost-control.ts 同一约定）：
 *   1. 读取本应用的 LLM_PROVIDER / BASE_URL 环境判定调用目标；
 *   2. 用 sharp 实现「发送前把图片最长边压到 1024px 以内」的降分辨率端口；
 *   3. 打印控制台日志，便于线上确认压缩策略已生效。
 *
 * 主调目标：DeepSeek（https://api.deepseek.com，OpenAI 兼容 chat/completions）。
 */

import {
  appendConciseSystemPrompt,
  describePolicy,
  enforceGeminiConfig,
  enforceOpenAiParams,
  resolveTokenPolicy,
  visionEnforcement,
  type TokenPolicy,
} from "@commercial-engine/middleware/llm-token-guard";

/** 视觉压缩后统一输出格式（JPEG 体积更小、Gemini 全平台可解码） */
const VISION_JPEG_QUALITY = 72;

/**
 * 解析当前请求应使用的策略：
 *   - LLM_PROVIDER 优先（如 "ollama" 直接本地豁免）；
 *   - 否则以 BASE_URL / 实际调用端点判定（本仓库默认 DeepSeek 云端付费）。
 *
 * DeepSeek 端点（api.deepseek.com）由共享引擎按域名识别为付费 Provider，
 * 自动注入省钱规则：max_tokens=1000、temperature=0.2、Vision detail=low、
 * 分辨率 ≤1024px 与极简 System Prompt。
 */
export function currentTokenPolicy(endpoint?: string): TokenPolicy {
  const provider = process.env.LLM_PROVIDER || "deepseek";
  const baseUrl = process.env.BASE_URL || endpoint || null;
  return resolveTokenPolicy({ provider, baseUrl });
}

export interface GuardedVisionImage {
  /** 发送给模型的 Base64（已按策略决定是否压缩） */
  base64: string;
  mimeType: string;
  downscaled: boolean;
  /** 压缩前后的最长边（px），用于日志核对 */
  fromEdge?: number;
  toEdge?: number;
}

/**
 * Vision 降分辨率端口（sharp 实现）：
 *   - 仅当策略要求压缩且启用 vision 时下调；
 *   - 最长边 > 1024px 才重采样，否则原图直通（避免无谓重编码损失画质）；
 *   - 任何异常都回退原图，绝不因降本动作导致识图失败。
 */
export async function downscaleImageBase64(
  base64: string,
  mimeType: string,
  maxEdge: number
): Promise<GuardedVisionImage> {
  try {
    // 动态导入：sharp 来自 Next 的可选依赖（非本包直接依赖）。
    // 缺失时直接回退原图，绝不让降本动作拖垮识图链路。
    const { default: sharp } = await import("sharp");
    const input = Buffer.from(base64, "base64");
    const pipeline = sharp(input, { failOn: "none" });
    const meta = await pipeline.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const edge = Math.max(width, height);

    if (!edge || edge <= maxEdge) {
      return { base64, mimeType, downscaled: false, fromEdge: edge || undefined };
    }

    const out = await pipeline
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: VISION_JPEG_QUALITY })
      .toBuffer();

    return {
      base64: out.toString("base64"),
      mimeType: "image/jpeg",
      downscaled: true,
      fromEdge: edge,
      toEdge: maxEdge,
    };
  } catch (err: unknown) {
    console.warn(
      "[token-guard] 图片降分辨率失败，回退原图:",
      err instanceof Error ? err.message : err
    );
    return { base64, mimeType, downscaled: false };
  }
}

/** 按策略处理图片（本地豁免时原样返回） */
export async function enforceVisionImage(
  base64: string,
  mimeType: string,
  policy: TokenPolicy
): Promise<GuardedVisionImage> {
  const vision = visionEnforcement(policy);
  if (!vision.enabled || !vision.maxEdgePx) {
    return { base64, mimeType, downscaled: false };
  }
  return downscaleImageBase64(base64, mimeType, vision.maxEdgePx);
}

/** Gemini generationConfig 强制重写（本地豁免时不做任何上限注入） */
export function guardGeminiConfig(
  base: Record<string, unknown>,
  policy: TokenPolicy,
  options: { vision?: boolean } = {}
): Record<string, unknown> {
  return enforceGeminiConfig({ ...base }, policy, options);
}

/**
 * DeepSeek（OpenAI 兼容 chat/completions）省钱参数强制注入：
 *   - 云端付费 → max_tokens=1000、temperature=0.2（覆盖调用方传入值）；
 *   - 本地豁免 → 原样返回，不注入任何上限。
 */
export function guardDeepSeekParams(
  base: Record<string, unknown>,
  policy: TokenPolicy
): Record<string, unknown> {
  return enforceOpenAiParams({ ...base }, policy);
}

/**
 * System Prompt 极简注入：
 *   - 付费压缩 → 返回极简强约束文本（挂到 systemInstruction）；
 *   - 本地豁免 → 返回空串，调用方据此不注入，保持完整 CoT。
 */
export function guardSystemPrompt(policy: TokenPolicy, basePrompt = ""): string {
  return appendConciseSystemPrompt(basePrompt, policy);
}

/** 控制台日志：线上核对 max_tokens / detail / system prompt 是否已生效 */
export function logTokenGuard(
  policy: TokenPolicy,
  detail: { vision?: boolean; image?: GuardedVisionImage } = {}
): void {
  const parts = [describePolicy(policy)];
  if (detail.vision) {
    const img = detail.image;
    if (img?.downscaled) {
      parts.push(
        `image=downscaled(${img.fromEdge}px→${img.toEdge}px, ${img.mimeType})`
      );
    } else if (img) {
      parts.push(`image=passthrough(${img.fromEdge ? `${img.fromEdge}px` : "unknown"})`);
    }
  }
  if (policy.compress) {
    parts.push("system_prompt=concise-injected");
  } else {
    parts.push("system_prompt=untouched");
  }
  console.log(parts.join(" | "));
}
