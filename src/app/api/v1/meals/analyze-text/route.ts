import { NextRequest, NextResponse } from "next/server";
import { getClientIp, checkAntiCrawler, rateLimitRequest } from "@/lib/anti-crawler";
import { db } from "@/lib/db";
import { createGatewayClient } from "@/lib/gateway-client";
import { APP_CONFIG, normalizeGeminiModel } from "@/lib/app-config";
import { findLocalFoodInText, getFoodCache, setFoodCache } from "@/lib/cache/foodCache";
import { reserveMealCredit } from "@/lib/cost-control";

// 中央网关接入（可选）：配置 GATEWAY_BASE_URL + GATEWAY_APP_KEY 时优先走统一文字分析端点；
// 网关未配置或不可用时自动回退直连 Gemini，避免报错或返回空值。
const gateway = createGatewayClient({
  baseUrl: process.env.GATEWAY_BASE_URL || "",
  appId: "calorieai",
  appKey: process.env.GATEWAY_APP_KEY || "",
});

/**
 * POST /api/v1/meals/analyze-text
 *
 * 接收用户食物描述文本（如 “吃了200g米饭和100g西兰花”），调用 Google Gemini 估算营养数据。
 *
 * 请求体: { text: string, meal_type?: string }
 * 响应:
 *   {
 *     count: number,
 *     records: FoodRecord[],   // 兼容旧前端结构
 *     items: FoodRecord[],     // 与 records 同构的别名
 *     totalKcal, totalProtein, totalFat, totalCarbs: number,   // 汇总
 *     model: { provider, model, label, switched, attempts, gateway? }
 *   }
 *
 * 模型配置:
 *   - GEMINI_API_KEY      → Google Gemini（文本生成）
 * 如果未配置或调用失败，返回可诊断错误，绝不回退固定 Mock 数据。
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(request);
  const ua = request.headers.get("user-agent") || "";

  try {
    // ── WAF 反爬虫校验 ──
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

    // ── 单 IP 频次限制 ──
    const rl = rateLimitRequest(ip);
    if (!rl.allowed) {
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "TEXT",
        status: 429,
        latency_ms: Date.now() - startTime,
        error: "RATE_LIMITED",
      });
      return NextResponse.json(
        { detail: "请求过于频繁，请稍后再试", code: "RATE_LIMITED", retry_after: rl.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds || 60) } }
      );
    }

    // ── 解析并校验请求体 ──
    let body: any = {};
    try {
      body = await request.json();
    } catch (err: any) {
      console.warn("[Text] 请求体非 JSON:", err.message);
      return NextResponse.json({ detail: "请求体必须为 JSON（{ text, meal_type? }）", code: "INVALID_JSON" }, { status: 400 });
    }
    const text = String(body?.text || "").trim();
    const mealType = String(body?.meal_type || "unknown");
    if (!text) {
      return NextResponse.json({ detail: "请输入食物描述文本", code: "EMPTY_TEXT" }, { status: 400 });
    }
    if (text.length > 500) {
      return NextResponse.json({ detail: "食物描述过长（最多 500 字）", code: "TEXT_TOO_LONG" }, { status: 400 });
    }
    console.log(`[Text] 收到分析请求: ip=${ip} meal_type=${mealType} text="${text.slice(0, 80)}..."`);

    const localFoodName = findLocalFoodInText(text);
    if (localFoodName && !/[和与,，、及&]/.test(text.replace(localFoodName, ""))) {
      const cached = await getFoodCache([localFoodName]);
      if (cached) {
        const record = cached[0];
        return NextResponse.json({
          count: 1,
          records: [record],
          items: [record],
          totalKcal: record.calories,
          totalProtein: record.protein_g,
          totalFat: record.fat_g,
          totalCarbs: record.carbs_g,
          model: { provider: "local", model: "static-food-db", label: "Local Food DB", switched: false, attempts: 0 },
        });
      }
    }

    const userId = String(body?.user_id || request.headers.get("x-user-id") || "anonymous");
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

    // ── 中央网关优先：统一文字分析（失败自动回退直连）──
    if (gateway.isConfigured()) {
      try {
        const gw = await gateway.text({ text, meal_type: mealType });
        console.log(`[Text][Gateway] 网关分析成功: provider=${gw.model.provider} count=${gw.count}`);
        await db.recordVisionLog({
          ip,
          provider: "text",
          model: gw.model.model,
          label: gw.model.label,
          status: 200,
          latency_ms: Date.now() - startTime,
          count: gw.count,
        });
        return NextResponse.json({ ...gw, model: { ...gw.model, gateway: true } });
      } catch (gwErr: any) {
        console.warn("[Text][Gateway] 网关文字分析失败，回退直连:", gwErr.message);
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[Text] No API key configured (GEMINI_API_KEY)");
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "TEXT",
        status: 503,
        latency_ms: Date.now() - startTime,
        error: "NO_TEXT_KEY",
      });
      return NextResponse.json(
        {
          error: "未配置 AI 文本密钥（GEMINI_API_KEY），无法分析",
          detail: "未配置 AI 文本密钥（GEMINI_API_KEY），无法分析",
          code: "NO_TEXT_KEY",
        },
        { status: 503 }
      );
    }

    try {
      const result = await analyzeTextWithGemini(text, mealType, apiKey);
      const payload = buildPayload(result, 1);
      console.log(
        `[Text] 分析成功，命中提供商: ${result.model.label}（count=${result.count}）`
      );
      await db.recordVisionLog({
        ip,
        provider: "text",
        model: result.model.model,
        label: result.model.label,
        status: 200,
        latency_ms: Date.now() - startTime,
        count: result.count,
      });
      const cacheNames = result.records.map((record) => String(record.food || "")).filter(Boolean);
      if (cacheNames.length) await setFoodCache(cacheNames, result.records);
      return NextResponse.json(payload);
    } catch (err: any) {
      console.error("[Text] Gemini API failed:", err.message);
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "TEXT",
        status: 502,
        latency_ms: Date.now() - startTime,
        error: (err?.message || "Gemini Error").slice(0, 200),
      });
      return NextResponse.json(
        {
          error: "Gemini API Error: " + (err?.message || "未知错误"),
          detail: "Gemini API Error: " + (err?.message || "未知错误"),
          code: "TEXT_PROVIDER_ERROR",
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error("[Text Error]", error);
    await db.recordVisionLog({
      ip,
      provider: "api",
      label: "TEXT",
      status: 500,
      latency_ms: Date.now() - startTime,
      error: (error?.message || "UNKNOWN").slice(0, 200),
    });
    return NextResponse.json({ error: "文字分析失败: " + (error?.message || "未知错误"), detail: "文字分析失败: " + (error?.message || "未知错误"), code: "TEXT_ERROR" }, { status: 500 });
  }
}

// ─── 提供商封装（与 analyze-image 同构，文本版） ──────────────────────

type TextProviderName = "gemini";

interface TextAnalysisResult {
  count: number;
  records: FoodRecord[];
  model: { provider: TextProviderName; model: string; label: string; switched: boolean };
}

interface FoodRecord {
  food: string;
  food_en: string;
  grams: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  confidence: number | null;
}

const PROVIDER_DISPLAY: Record<TextProviderName, string> = {
  gemini: "Gemini",
};

function buildModelLabel(provider: TextProviderName, model: string): string {
  return `${PROVIDER_DISPLAY[provider]} (${model})`;
}

/** 构造文字分析提示词（来自套娃应用统一配置 app-config，克隆时按应用替换） */
function buildTextPrompt(text: string, mealType: string): string {
  return APP_CONFIG.prompts.text(text, mealType);
}

/** Google Gemini（文本生成，默认低成本模型 gemini-1.5-flash，模型 ID 自动剥离 "models/" 前缀） */
async function analyzeTextWithGemini(
  text: string,
  mealType: string,
  apiKey: string
): Promise<TextAnalysisResult> {
  const model = normalizeGeminiModel(process.env.GEMINI_MODEL || APP_CONFIG.models.text);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildTextPrompt(text, mealType) }] }],
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
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const records = parseFoodRecords(raw);
  return {
    count: records.length,
    records,
    model: { provider: "gemini", model, label: buildModelLabel("gemini", model), switched: false },
  };
}

/** 稳健解析 AI 返回的食物 JSON（纯数组 / 代码块 / 对象包装 / 夹带文字） */
function parseFoodRecords(text: string): FoodRecord[] {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

  const tryParse = (raw: string): any[] | null => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        for (const key of ["records", "items", "foods"]) {
          if (Array.isArray(parsed[key])) return parsed[key];
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  const toNum = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const normalize = (items: any[]): FoodRecord[] =>
    items
      .filter((item) => item && typeof item === "object")
      .map((raw) => ({
        food: String(raw.food ?? raw.name ?? raw.food_name ?? raw.food_en ?? "未知"),
        food_en: String(raw.food_en ?? raw.name_en ?? ""),
        grams: toNum(raw.grams ?? raw.gram ?? raw.weight_g ?? raw.weight ?? raw.estimated_weight_g),
        calories: toNum(raw.calories ?? raw.cal ?? raw.kcal ?? raw.calorie),
        protein_g: toNum(raw.protein_g ?? raw.protein),
        fat_g: toNum(raw.fat_g ?? raw.fat),
        carbs_g: toNum(raw.carbs_g ?? raw.carbs ?? raw.carbohydrates_g ?? raw.carbohydrates),
        confidence:
          raw.confidence != null
            ? toNum(raw.confidence)
            : raw.confidence_score != null
              ? toNum(raw.confidence_score)
              : null,
      }));

  const direct = tryParse(cleaned);
  if (direct !== null) return normalize(direct);
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted !== null) return normalize(extracted);
  }
  throw new Error("AI 返回内容无法解析为 JSON 数组");
}

/** 组装统一响应：records + items 别名 + 总计（P/F/C） */
function buildPayload(result: TextAnalysisResult, attempts: number) {
  const records = result.records;
  const totalKcal = records.reduce((s, r) => s + (Number(r.calories) || 0), 0);
  const totalProtein = records.reduce((s, r) => s + (Number(r.protein_g) || 0), 0);
  const totalFat = records.reduce((s, r) => s + (Number(r.fat_g) || 0), 0);
  const totalCarbs = records.reduce((s, r) => s + (Number(r.carbs_g) || 0), 0);
  return {
    count: result.count,
    records,
    items: records,
    totalKcal,
    totalProtein,
    totalFat,
    totalCarbs,
    model: {
      ...result.model,
      provider: result.model.provider,
      switched: attempts > 1,
      attempts,
    },
  };
}
