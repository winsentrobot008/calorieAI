import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  checkAntiCrawler,
  dailyRateLimitRequestDistributed,
  rateLimitRequestDistributed,
} from "@/lib/anti-crawler";
import { db } from "@/lib/db";
import { APP_CONFIG, normalizeGeminiModel } from "@/lib/app-config";
import { refundMealCredit, reserveMealCredit, resolveMealUserId } from "@/lib/cost-control";

// 图片体积上限：4MB 为请求体硬上限（在 Vercel 4.5MB Body Limit 前先拦截）；
// ≤200KB 为 Gemini inline 数据降本上限（客户端 Canvas 压缩后通常 ~50-150KB）。
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_BYTES = 200 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** Gemini 调用超时（毫秒）：防止上游挂起长期占用 Serverless 实例 */
const GEMINI_TIMEOUT_MS = 15_000;

/**
 * POST /api/v1/meals/analyze-image
 *
 * 接收上传的食物图片，将其 Base64 编码后发送给 Google Gemini Vision 模型识别。
 * 输入兼容两种形式：
 *   - multipart/form-data：`file` 为图片 File（前端已 Canvas 压缩 ≤200KB）；
 *   - `file` 字段直接传 data URI（`data:image/jpeg;base64,`）或裸 Base64 字符串，
 *     服务端自动剥离 data URI 前缀后再发送给 Gemini。
 *
 * 模型配置:
 *   - GEMINI_API_KEY    → Google Gemini Vision
 *   - GEMINI_MODEL      （默认取 APP_CONFIG.models.vision = gemini-2.5-flash，低成本视觉模型；
 *                         会自动剥离误配的 "models/" 前缀，模型 ID 必须是裸名称）
 *
 * Vision API 降本规范（v1）：
 *   - Gemini 原生接口 generationConfig.maxOutputTokens=200 + responseMimeType=application/json；
 *   - 单 IP 每日 ≤ 30 次 + 每分钟 ≤ 6 次双闸门（Upstash 分布式优先，未配置时回退进程内）。
 *
 * Prompt 契约：每项对象严格匹配
 *   { food_name, estimated_calories, macronutrients{protein_g,fat_g,carbs_g}, confidence_score }
 *   服务端归一化为前端 records 字段（food/calories/protein_g/fat_g/carbs_g/confidence）。
 *
 * 统一返回 Payload:
 *   {
 *     count: number,
 *     records: Array<{
 *       food: string,          // 食物名称
 *       food_en: string,       // 英文名
 *       grams: number,         // 估算重量 (g)
 *       calories: number,      // 卡路里 (kcal)
 *       protein_g: number,     // 蛋白质 (g)
 *       fat_g: number,         // 脂肪 (g)
 *       carbs_g: number,       // 碳水 (g)
 *       confidence: number | null
 *     }>,
 *     model: {
 *       provider: string,   // 命中提供商: gemini
 *       model: string,      // 实际使用的模型 ID（如 gemini-2.5-flash）
 *       label: string,      // 展示名（如 "Gemini (gemini-2.5-flash)"）
 *       switched: boolean,  // false
 *       attempts: number    // 1
 *     }
 *   }
 *
 * 如果未配置或调用失败，返回明确错误（NO_VISION_KEY / AI_SERVICE_UNAVAILABLE），
 * 绝不回退到固定 Mock 数据，避免把演示数据误当真实识别结果。
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(request);
  const ua = request.headers.get("user-agent") || "";
  let creditsReserved = false;
  let userId = "";

  try {
    // ── WAF 反爬虫校验：拦截明显 Bot / 自动化客户端 ──
    const guard = checkAntiCrawler(ua);
    if (guard.blocked) {
      await db.recordVisionLog({
        ip,
        provider: "waf",
        label: "WAF",
        status: 403,
        latency_ms: Date.now() - startTime,
        error: guard.reason,
      });
      return NextResponse.json(
        { detail: "请求被安全网关拦截", code: "BLOCKED_BY_WAF", reason: guard.reason },
        { status: 403, headers: { "X-WAF-Block": guard.reason || "blocked" } }
      );
    }

    // ── 单 IP 频次限制：防恶意并发消耗 API 额度 ──
    const rl = await rateLimitRequestDistributed(ip);
    if (!rl.allowed) {
      await db.recordVisionLog({
        ip,
        provider: "waf",
        label: "WAF",
        status: 429,
        latency_ms: Date.now() - startTime,
        error: "RATE_LIMITED",
      });
      return NextResponse.json(
        { detail: "请求过于频繁，请稍后再试", code: "RATE_LIMITED", retry_after: rl.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds || 60) } }
      );
    }

    // ── Vision API 降本：单 IP 每日 30 次硬上限（滑动窗口 24h） ──
    const daily = await dailyRateLimitRequestDistributed(ip);
    if (!daily.allowed) {
      await db.recordVisionLog({
        ip,
        provider: "waf",
        label: "WAF",
        status: 429,
        latency_ms: Date.now() - startTime,
        error: "DAILY_RATE_LIMITED",
      });
      return NextResponse.json(
        {
          detail: "今日识图次数已达上限（30 次/日），请明天再试",
          code: "DAILY_RATE_LIMITED",
          retry_after: daily.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(daily.retryAfterSeconds || 86400) },
        }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      // 非 multipart/form-data 请求体（如 urlencoded/JSON）视为缺少文件
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "API",
        status: 400,
        latency_ms: Date.now() - startTime,
        error: "INVALID_FORM_DATA",
      });
      return NextResponse.json({ detail: "请上传图片文件" }, { status: 400 });
    }
    const rawFile = formData.get("file");
    const mealType = formData.get("meal_type")?.toString() || "unknown";

    // 兼容 multipart File 与 data URI / 裸 Base64 字符串两种输入
    let base64 = "";
    let mimeType = "";

    if (!rawFile) {
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "API",
        status: 400,
        latency_ms: Date.now() - startTime,
        error: "MISSING_FILE",
      });
      return NextResponse.json({ detail: "请上传图片文件" }, { status: 400 });
    }

    if (typeof rawFile === "string") {
      // ── data URI / 裸 Base64：剥离 "data:<mime>;base64," 前缀，防止把前缀误当图像数据 ──
      const parsed = extractInlineImage(rawFile);
      if (!parsed || !parsed.base64) {
        await db.recordVisionLog({
          ip,
          provider: "api",
          label: "API",
          status: 400,
          latency_ms: Date.now() - startTime,
          error: "INVALID_IMAGE_DATA",
        });
        return NextResponse.json(
          { detail: "图片数据无效（需为 base64 或 data URI）", code: "INVALID_IMAGE_DATA" },
          { status: 400 }
        );
      }
      base64 = parsed.base64;
      mimeType = parsed.mimeType || "image/jpeg";
      const approxBytes = Math.ceil((base64.length * 3) / 4);

      if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
        await db.recordVisionLog({
          ip,
          provider: "api",
          label: "API",
          status: 400,
          latency_ms: Date.now() - startTime,
          error: `UNSUPPORTED_TYPE: ${mimeType}`,
        });
        return NextResponse.json(
          { detail: "不支持的图片格式，请上传 JPEG/PNG/WebP（HEIC 需在客户端自动转换）" },
          { status: 400 }
        );
      }
      if (approxBytes > MAX_UPLOAD_BYTES) {
        await db.recordVisionLog({
          ip,
          provider: "api",
          label: "API",
          status: 413,
          latency_ms: Date.now() - startTime,
          error: `PAYLOAD_TOO_LARGE: ${approxBytes}`,
        });
        return NextResponse.json(
          { detail: "图片超过 4MB，请压缩后重试", code: "PAYLOAD_TOO_LARGE" },
          { status: 413 }
        );
      }
      if (approxBytes > MAX_INLINE_BYTES) {
        await db.recordVisionLog({
          ip,
          provider: "api",
          label: "API",
          status: 400,
          latency_ms: Date.now() - startTime,
          error: `IMAGE_TOO_LARGE: ${approxBytes}`,
        });
        return NextResponse.json(
          { detail: "图片体积过大（需 ≤200KB），请重新拍照或选择较小图片", code: "IMAGE_TOO_LARGE" },
          { status: 400 }
        );
      }
    } else {
      // ── multipart File：类型 + 4MB 请求体上限 + ≤200KB Gemini inline 降本闸门 ──
      const file = rawFile as File;
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        await db.recordVisionLog({
          ip,
          provider: "api",
          label: "API",
          status: 400,
          latency_ms: Date.now() - startTime,
          error: `UNSUPPORTED_TYPE: ${file.type}`,
        });
        return NextResponse.json(
          { detail: "不支持的图片格式，请上传 JPEG/PNG/WebP（HEIC 需在客户端自动转换）" },
          { status: 400 }
        );
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        await db.recordVisionLog({
          ip,
          provider: "api",
          label: "API",
          status: 413,
          latency_ms: Date.now() - startTime,
          error: `PAYLOAD_TOO_LARGE: ${file.size}`,
        });
        return NextResponse.json(
          { detail: "图片超过 4MB，请压缩后重试", code: "PAYLOAD_TOO_LARGE" },
          { status: 413 }
        );
      }
      if (file.size > MAX_INLINE_BYTES) {
        await db.recordVisionLog({
          ip,
          provider: "api",
          label: "API",
          status: 400,
          latency_ms: Date.now() - startTime,
          error: `IMAGE_TOO_LARGE: ${file.size}`,
        });
        return NextResponse.json(
          { detail: "图片体积过大（需 ≤200KB），请重新拍照或选择较小图片", code: "IMAGE_TOO_LARGE" },
          { status: 400 }
        );
      }
      const bytes = await file.arrayBuffer();
      base64 = Buffer.from(bytes).toString("base64");
      mimeType = file.type;
    }

    userId = await resolveMealUserId(
      String(formData.get("user_id") || request.headers.get("x-user-id") || ""),
      ip
    );
    const creditGuard = await reserveMealCredit(userId, ip);
    if (!creditGuard.allowed) {
      return NextResponse.json(
        {
          detail: creditGuard.status === 402 ? "积分不足，请先充值" : "请求过于频繁，请稍后再试",
          code: creditGuard.code,
        },
        {
          status: creditGuard.status,
          headers: creditGuard.retryAfter ? { "Retry-After": String(creditGuard.retryAfter) } : undefined,
        }
      );
    }
    creditsReserved = true;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[Vision] No API key configured (GEMINI_API_KEY)");
      await refundMealCredit(userId);
      creditsReserved = false;
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "VISION",
        status: 503,
        latency_ms: Date.now() - startTime,
        error: "NO_VISION_KEY",
      });
      return NextResponse.json(
        {
          error: "未配置 AI 视觉密钥（GEMINI_API_KEY），无法识图",
          detail: "未配置 AI 视觉密钥（GEMINI_API_KEY），无法识图",
          code: "NO_VISION_KEY",
        },
        { status: 503 }
      );
    }

    try {
      const result = await analyzeWithGemini(base64, mimeType, mealType, apiKey);
      console.log(`[Vision] 识别成功，命中提供商: ${result.model.label}`);
      await db.recordVisionLog({
        ip,
        provider: result.model.provider,
        model: result.model.model,
        label: result.model.label,
        status: 200,
        latency_ms: Date.now() - startTime,
        count: result.count,
      });
      return NextResponse.json({
        ...result,
        remainingCredits: creditGuard.remaining,
        model: { ...result.model, provider: "gemini", switched: false, attempts: 1 },
      });
    } catch (err: any) {
      const isParseError = /无法解析/.test(err?.message || "");
      if (creditsReserved) {
        await refundMealCredit(userId);
        creditsReserved = false;
      }
      console.error(
        `[Vision] Gemini API failed (${isParseError ? "PARSE_ERROR" : "PROVIDER_ERROR"}):`,
        err?.message || err
      );
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "VISION",
        status: 502,
        latency_ms: Date.now() - startTime,
        error: (err?.message || "Gemini Error").slice(0, 200),
      });
      return NextResponse.json(
        {
          error: "AI 服务暂时不可用，请稍后再试",
          detail: "AI 服务暂时不可用，请稍后再试",
          code: "AI_SERVICE_UNAVAILABLE",
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    if (creditsReserved) {
      await refundMealCredit(userId);
      creditsReserved = false;
    }
    console.error("[Vision Error]", error);
    await db.recordVisionLog({
      ip,
      provider: "api",
      label: "VISION",
      status: 500,
      latency_ms: Date.now() - startTime,
      error: (error?.message || "UNKNOWN").slice(0, 200),
    });
    return NextResponse.json(
      {
        error: "AI 服务暂时不可用，请稍后再试",
        detail: "AI 服务暂时不可用，请稍后再试",
        code: "AI_SERVICE_UNAVAILABLE",
      },
      { status: 500 }
    );
  }
}

type ProviderName = "gemini";

interface AnalysisResult {
  count: number;
  records: any[];
  total_cal?: number;
  model: { provider: ProviderName; model: string; label: string; switched: boolean };
}

const PROVIDER_DISPLAY: Record<ProviderName, string> = {
  gemini: "Gemini",
};

/** 生成前端可直接展示的模型名，如 "Gemini (gemini-2.5-flash)" */
function buildModelLabel(provider: ProviderName, model: string): string {
  return `${PROVIDER_DISPLAY[provider]} (${model})`;
}

/** 构造统一的识图提示词（来自套娃应用统一配置 app-config，克隆时按应用替换） */
function buildPrompt(mealType: string): string {
  return APP_CONFIG.prompts.image(mealType);
}

/**
 * 解析 data URI（`data:<mime>;base64,<payload>`）或裸 Base64。
 * 统一剥离 "data:image/jpeg;base64," 等前缀，防止把前缀误当图像数据发给 Gemini；
 * 同时返回 data URI 自带的 mimeType（file.type 缺失时可用）。
 */
function extractInlineImage(input: string): { mimeType: string | null; base64: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)?(;base64)?,([\s\S]*)$/.exec(trimmed);
  if (match && match[3]) {
    return { mimeType: match[1] || null, base64: match[3].replace(/\s+/g, "") };
  }
  return { mimeType: null, base64: trimmed.replace(/\s+/g, "") };
}

/** Google Gemini Vision（原生多模态接口） */
async function analyzeWithGemini(
  base64: string,
  mimeType: string,
  mealType: string,
  apiKey: string
): Promise<AnalysisResult> {
  const model = normalizeGeminiModel(process.env.GEMINI_MODEL || APP_CONFIG.models.vision);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: buildPrompt(mealType) },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 200,
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const parsed = parseRecords(text);
  const records = parsed.records;

  return {
    count: records.length,
    records,
    total_cal: parsed.total_cal,
    model: { provider: "gemini", model, label: buildModelLabel("gemini", model), switched: false },
  };
}

/**
 * 稳健解析 AI 返回的食物 JSON：
 * 支持极简 JSON 约束结构 {"items":[...],"total_cal":N}、纯 JSON 数组、
 * Markdown 代码块包裹、前后附带说明文字，以及
 * { records | items | foods: [...] } 等对象包装形式。
 * 解析后统一规范化为前端所需字段（食物名称/估算重量/卡路里/蛋白质/脂肪/碳水）。
 */
function parseRecords(text: string): { records: any[]; total_cal?: number } {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

  const tryParse = (raw: string): { records: any[]; total_cal?: number } | null => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return { records: parsed };
      if (parsed && typeof parsed === "object") {
        for (const key of ["records", "items", "foods"]) {
          if (Array.isArray(parsed[key])) {
            return {
              records: parsed[key],
              total_cal: toNumber(parsed.total_cal) || undefined,
            };
          }
        }
        // 单对象兜底：模型可能只返回一个食物对象（含 food_name / estimated_calories 等主契约字段）
        if (isFoodLike(parsed)) return { records: [parsed] };
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleaned);
  if (direct !== null) return { records: normalizeRecords(direct.records), total_cal: direct.total_cal };

  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted !== null) {
      return { records: normalizeRecords(extracted.records), total_cal: extracted.total_cal };
    }
  }

  throw new Error("AI 返回内容无法解析为食物 JSON 数组");
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 判断是否为单个食物对象（主契约字段 food_name / estimated_calories 等） */
function isFoodLike(value: any): boolean {
  return !!(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value.food_name || value.food || value.name || value.estimated_calories || value.calories)
  );
}

/** 统一字段规范化：兼容各模型返回的字段命名差异 */
function normalizeRecords(items: any[]): any[] {
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      // 主契约嵌套结构 macronutrients.{protein_g,fat_g,carbs_g}
      const macros =
        item.macronutrients && typeof item.macronutrients === "object" ? item.macronutrients : {};
      return {
        food: String(item.food ?? item.name ?? item.food_name ?? item.food_en ?? "未知食物"),
        food_en: String(item.food_en ?? item.name_en ?? ""),
        grams: toNumber(item.grams ?? item.gram ?? item.weight_g ?? item.weight ?? item.estimated_weight_g),
        calories: toNumber(item.estimated_calories ?? item.calories ?? item.cal ?? item.kcal ?? item.calorie),
        protein_g: toNumber(macros.protein_g ?? macros.protein ?? item.protein_g ?? item.protein),
        fat_g: toNumber(macros.fat_g ?? macros.fat ?? item.fat_g ?? item.fat),
        carbs_g: toNumber(
          macros.carbs_g ?? macros.carbs ?? item.carbs_g ?? item.carbs ?? item.carbohydrates_g ?? item.carbohydrates
        ),
        confidence:
          item.confidence != null
            ? toNumber(item.confidence)
            : item.confidence_score != null
              ? toNumber(item.confidence_score)
              : null,
      };
    });
}
