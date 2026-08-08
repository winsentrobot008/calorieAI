import { NextRequest, NextResponse } from "next/server";
import { getClientIp, checkAntiCrawler, rateLimitRequest } from "@/lib/anti-crawler";
import { db } from "@/lib/db";
import { createGatewayClient } from "@/lib/gateway-client";

// 中央网关接入（可选）：配置 GATEWAY_BASE_URL + GATEWAY_APP_KEY 时启用
const gateway = createGatewayClient({
  baseUrl: process.env.GATEWAY_BASE_URL || "",
  appId: "calorieai",
  appKey: process.env.GATEWAY_APP_KEY || "",
});

/**
 * POST /api/v1/meals/analyze-image
 *
 * 接收上传的食物图片，将其 Base64 编码后发送给视觉 AI 模型识别。
 *
 * 提供商 A → B → C 自动回退链（按顺序尝试，任一成功即返回真实识别结果）:
 *   - A: GEMINI_API_KEY      → Google Gemini Vision（原生多模态接口）
 *   - B: OPENROUTER_API_KEY  → OpenRouter 聚合视觉模型（OpenAI 兼容接口）
 *   - C: DEEPSEEK_API_KEY    → DeepSeek（OpenAI 兼容接口；官方文本模型不支持图片时
 *                               会快速失败并交回回退链 / 返回可诊断错误）
 *
 * 可选模型覆盖:
 *   - GEMINI_MODEL      （默认 gemini-2.0-flash）
 *   - OPENROUTER_MODEL  （默认 openai/gpt-4o-mini）
 *   - DEEPSEEK_MODEL    （默认 deepseek-chat）
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
 *       provider: string,   // 命中提供商: gemini | openrouter | deepseek
 *       model: string,      // 实际使用的模型 ID（如 gemini-2.0-flash / openai/gpt-4o-mini）
 *       label: string,      // 展示名（如 "Gemini (gemini-2.0-flash)" / "OpenRouter (gpt-4o-mini)"）
 *       switched: boolean,  // 是否为回退提供商命中
 *       attempts: number    // 实际尝试过的提供商数量
 *     }
 *   }
 *
 * 如果均未配置或全部调用失败，返回明确错误（NO_VISION_KEY / VISION_PROVIDER_ERROR），
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

    // A → B → C 回退链定义（严格按数组顺序尝试，缺失密钥自动跳过）
    const providers: VisionProvider[] = [
      {
        name: "gemini",
        apiKey: process.env.GEMINI_API_KEY,
        analyze: (apiKey) => analyzeWithGemini(base64, mimeType, mealType, apiKey),
      },
      {
        name: "openrouter",
        apiKey: process.env.OPENROUTER_API_KEY,
        analyze: (apiKey) => analyzeWithOpenRouter(base64, mimeType, mealType, apiKey),
      },
      {
        name: "deepseek",
        apiKey: process.env.DEEPSEEK_API_KEY,
        analyze: (apiKey) => analyzeWithDeepSeek(base64, mimeType, mealType, apiKey),
      },
    ];

    let lastError: Error | null = null;
    let attempted = 0;

    for (const provider of providers) {
      const apiKey = provider.apiKey;
      if (!apiKey) continue;
      attempted += 1;
      try {
        const result = await provider.analyze(apiKey);
        // 服务端日志显式记录命中提供商与模型名
        console.log(`[Vision] 识别成功，命中提供商: ${result.model.label}（attempts=${attempted}）`);
        // 运行日志：记录命中模型、耗时与结果数量
        await db.recordVisionLog({
          ip,
          provider: result.model.provider,
          model: result.model.model,
          label: result.model.label,
          status: 200,
          latency_ms: Date.now() - startTime,
          count: result.count,
        });
        // 统一附上回退元数据：switched=true 表示实际由备用提供商完成识别
        return NextResponse.json({
          ...result,
          model: { ...result.model, provider: provider.name, switched: attempted > 1, attempts: attempted },
        });
      } catch (err: any) {
        lastError = err;
        console.error(`[Vision] ${provider.name} failed:`, err.message);
      }
    }

    // 全部提供商失败：返回可诊断错误，绝不静默回退到固定 Mock 数据
    if (lastError) {
      console.error("[Vision] All providers failed:", lastError.message);
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "VISION",
        status: 502,
        latency_ms: Date.now() - startTime,
        error: lastError.message.slice(0, 200),
      });
      return NextResponse.json(
        { detail: "AI 视觉识别失败: " + lastError.message, code: "VISION_PROVIDER_ERROR" },
        { status: 502 }
      );
    }

    // 无任何密钥：明确报错（NO_VISION_KEY），不再返回固定 Mock 的白米饭
    console.warn("[Vision] No API key configured (GEMINI_API_KEY / OPENROUTER_API_KEY / DEEPSEEK_API_KEY)");
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
        detail: "未配置 AI 视觉密钥（GEMINI_API_KEY / OPENROUTER_API_KEY / DEEPSEEK_API_KEY），无法识图",
        code: "NO_VISION_KEY",
      },
      { status: 503 }
    );
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
    return NextResponse.json({ detail: "图像分析失败: " + error.message }, { status: 500 });
  }
}

type ProviderName = "gemini" | "openrouter" | "deepseek";

interface AnalysisResult {
  count: number;
  records: any[];
  model: { provider: ProviderName; model: string; label: string; switched: boolean };
}

interface VisionProvider {
  name: ProviderName;
  apiKey: string | undefined;
  analyze: (apiKey: string) => Promise<AnalysisResult>;
}

const PROVIDER_DISPLAY: Record<ProviderName, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
};

/** 生成前端可直接展示的模型名，如 "Gemini (gemini-2.0-flash)" / "OpenRouter (gpt-4o-mini)" */
function buildModelLabel(provider: ProviderName, model: string): string {
  const shortModel = provider === "openrouter" ? model.split("/").pop() || model : model;
  return `${PROVIDER_DISPLAY[provider]} (${shortModel})`;
}

/** 构造统一的识图提示词（要求返回含食物名称/重量/卡路里/蛋白质/脂肪/碳水的 JSON 数组） */
function buildPrompt(mealType: string): string {
  return `你是一位专业的营养师。请分析这张食物照片，返回 JSON 数组格式的食物列表。
每个对象必须包含: food(中文名), food_en(英文名), grams(估算重量克数), calories(卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
餐次类型: ${mealType}
只返回 JSON 数组，不要其他文字。`;
}

/** A: Google Gemini Vision（原生多模态接口） */
async function analyzeWithGemini(
  base64: string,
  mimeType: string,
  mealType: string,
  apiKey: string
): Promise<AnalysisResult> {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
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
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const records = parseRecords(text);

  return {
    count: records.length,
    records,
    model: { provider: "gemini", model, label: buildModelLabel("gemini", model), switched: false },
  };
}

/** OpenAI 兼容接口（供 OpenRouter / DeepSeek 复用） */
async function analyzeWithOpenAICompatible(
  base64: string,
  mimeType: string,
  mealType: string,
  apiKey: string,
  options: { provider: ProviderName; endpoint: string; model: string }
): Promise<AnalysisResult> {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(mealType) },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${options.provider} API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content || "[]";
  const records = parseRecords(text);

  return {
    count: records.length,
    records,
    model: {
      provider: options.provider,
      model: options.model,
      label: buildModelLabel(options.provider, options.model),
      switched: false,
    },
  };
}

/** B: OpenRouter（聚合多模型，OpenAI 兼容接口） */
function analyzeWithOpenRouter(
  base64: string,
  mimeType: string,
  mealType: string,
  apiKey: string
): Promise<AnalysisResult> {
  return analyzeWithOpenAICompatible(base64, mimeType, mealType, apiKey, {
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
  });
}

/** C: DeepSeek（OpenAI 兼容接口；官方文本模型不支持图片时会快速失败并交回回退链） */
function analyzeWithDeepSeek(
  base64: string,
  mimeType: string,
  mealType: string,
  apiKey: string
): Promise<AnalysisResult> {
  return analyzeWithOpenAICompatible(base64, mimeType, mealType, apiKey, {
    provider: "deepseek",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  });
}

/**
 * 稳健解析 AI 返回的食物 JSON：
 * 支持纯 JSON 数组、Markdown 代码块包裹、前后附带说明文字，以及
 * { records | items | foods: [...] } 等对象包装形式。
 * 解析后统一规范化为前端所需字段（食物名称/估算重量/卡路里/蛋白质/脂肪/碳水）。
 */
function parseRecords(text: string): any[] {
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

  const direct = tryParse(cleaned);
  if (direct !== null) return normalizeRecords(direct);

  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted !== null) return normalizeRecords(extracted);
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
      grams: toNumber(item.grams ?? item.weight_g ?? item.weight ?? item.estimated_weight_g),
      calories: toNumber(item.calories ?? item.kcal ?? item.calorie),
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
