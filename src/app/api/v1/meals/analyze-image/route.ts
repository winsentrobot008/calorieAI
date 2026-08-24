import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  checkAntiCrawler,
  rateLimitRequest,
  dailyRateLimitRequest,
} from "@/lib/anti-crawler";
import { db } from "@/lib/db";
import { createGatewayClient } from "@/lib/gateway-client";
import { APP_CONFIG, normalizeGeminiModel } from "@/lib/app-config";
import { reserveMealCredit } from "@/lib/cost-control";

// 中央网关接入（可选）：配置 GATEWAY_BASE_URL + GATEWAY_APP_KEY 时启用
const gateway = createGatewayClient({
  baseUrl: process.env.GATEWAY_BASE_URL || "",
  appId: "calorieai",
  appKey: process.env.GATEWAY_APP_KEY || "",
});

/**
 * POST /api/v1/meals/analyze-image
 *
 * 接收上传的食物图片，将其 Base64 编码后发送给 Google Gemini Vision 模型识别。
 *
 * 模型配置:
 *   - GEMINI_API_KEY    → Google Gemini Vision
 *   - GEMINI_MODEL      （默认取 APP_CONFIG.models.vision = gemini-1.5-flash，低成本视觉模型；
 *                         会自动剥离误配的 "models/" 前缀，模型 ID 必须是裸名称）
 *
 * Vision API 降本规范（v1）：
 *   - Gemini 原生接口 generationConfig.maxOutputTokens=200；
 *   - 单 IP 每日 ≤ 30 次（dailyRateLimitRequest）+ 每分钟 ≤ 6 次双闸门。
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
 *       model: string,      // 实际使用的模型 ID（如 gemini-1.5-flash）
 *       label: string,      // 展示名（如 "Gemini (gemini-1.5-flash)"）
 *       switched: boolean,  // false
 *       attempts: number    // 1
 *     }
 *   }
 *
 * 如果未配置或调用失败，返回明确错误（NO_VISION_KEY / VISION_PROVIDER_ERROR），
 * 绝不回退到固定 Mock 数据，避免把演示数据误当真实识别结果。
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(request);
  const ua = request.headers.get("user-agent") || "";

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
    const rl = rateLimitRequest(ip);
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
    const daily = dailyRateLimitRequest(ip);
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
    const file = formData.get("file") as File | null;
    const mealType = formData.get("meal_type")?.toString() || "unknown";

    if (!file) {
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

    // 校验文件类型
    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    if (!validTypes.includes(file.type)) {
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "API",
        status: 400,
        latency_ms: Date.now() - startTime,
        error: `UNSUPPORTED_TYPE: ${file.type}`,
      });
      return NextResponse.json({ detail: "不支持的图片格式，请上传 JPEG/PNG/WebP" }, { status: 400 });
    }

    // Vision API 降本：服务端兜底体积校验（≤200KB，前端压缩后通常 ~50-150KB）
    if (file.size > 200 * 1024) {
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

    const userId = String(formData.get("user_id") || request.headers.get("x-user-id") || "anonymous");
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

    // 读取图片为 Base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const mimeType = file.type;

    // ── 中央网关优先：统一 AI 识图（失败自动回退直连，旧业务不受影响） ──
    if (gateway.isConfigured()) {
      try {
        const gwForm = new FormData();
        gwForm.append("file", file);
        gwForm.append("meal_type", mealType);
        const gw = await gateway.vision(gwForm);
        await db.recordVisionLog({
          ip,
          provider: gw.model.provider,
          model: gw.model.model,
          label: gw.model.label,
          status: 200,
          latency_ms: Date.now() - startTime,
          count: gw.count,
        });
        return NextResponse.json({ ...gw, model: { ...gw.model, gateway: true } });
      } catch (gwErr: any) {
        console.warn("[Gateway] 网关识图失败，回退直连:", gwErr.message);
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[Vision] No API key configured (GEMINI_API_KEY)");
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
        model: { ...result.model, provider: "gemini", switched: false, attempts: 1 },
      });
    } catch (err: any) {
      console.error("[Vision] Gemini API failed:", err.message);
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
          error: "Gemini API Error: " + (err?.message || "未知错误"),
          detail: "Gemini API Error: " + (err?.message || "未知错误"),
          code: "VISION_PROVIDER_ERROR",
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error("[Vision Error]", error);
    await db.recordVisionLog({
      ip,
      provider: "api",
      label: "VISION",
      status: 500,
      latency_ms: Date.now() - startTime,
      error: (error?.message || "UNKNOWN").slice(0, 200),
    });
    return NextResponse.json({ error: "图像分析失败: " + error.message, detail: "图像分析失败: " + error.message }, { status: 500 });
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

/** 生成前端可直接展示的模型名，如 "Gemini (gemini-1.5-flash)" */
function buildModelLabel(provider: ProviderName, model: string): string {
  return `${PROVIDER_DISPLAY[provider]} (${model})`;
}

/** 构造统一的识图提示词（来自套娃应用统一配置 app-config，克隆时按应用替换） */
function buildPrompt(mealType: string): string {
  return APP_CONFIG.prompts.image(mealType);
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
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

/** 统一字段规范化：兼容各模型返回的字段命名差异 */
function normalizeRecords(items: any[]): any[] {
  return items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      food: String(item.food ?? item.name ?? item.food_name ?? item.food_en ?? "未知食物"),
      food_en: String(item.food_en ?? item.name_en ?? ""),
      grams: toNumber(item.grams ?? item.gram ?? item.weight_g ?? item.weight ?? item.estimated_weight_g),
      calories: toNumber(item.calories ?? item.cal ?? item.kcal ?? item.calorie),
      protein_g: toNumber(item.protein_g ?? item.protein),
      fat_g: toNumber(item.fat_g ?? item.fat),
      carbs_g: toNumber(item.carbs_g ?? item.carbs ?? item.carbohydrates_g ?? item.carbohydrates),
      confidence:
        item.confidence != null
          ? toNumber(item.confidence)
          : item.confidence_score != null
            ? toNumber(item.confidence_score)
            : null,
    }));
}
