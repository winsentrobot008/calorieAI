import { NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  checkAntiCrawler,
  dailyRateLimitRequestDistributed,
  rateLimitRequestDistributed,
} from "@/lib/anti-crawler";
import { db } from "@/lib/db";
import { isAdminRequest } from "@/lib/admin-access";
import { APP_CONFIG, deepSeekApiKey, deepSeekChatEndpoint, resolveDeepSeekModel } from "@/lib/app-config";
import { findLocalFoodInText, getFoodCache, setFoodCache } from "@/lib/cache/foodCache";
import {
  refundMealCredit,
  releaseTrialDailyLimit,
  reserveMealCredit,
  reserveTrialDailyLimit,
  resolveMealUserId,
} from "@/lib/cost-control";
import {
  currentTokenPolicy,
  guardDeepSeekParams,
  guardSystemPrompt,
  logTokenGuard,
} from "@/lib/model-guard";
import { recordTrafficEvent } from "@/lib/traffic-analytics";

/** DeepSeek 调用超时（毫秒）：防止上游挂起长期占用 Serverless 实例 */
const DEEPSEEK_TIMEOUT_MS = 15_000;

/**
 * POST /api/v1/meals/analyze-text
 *
 * 接收用户食物描述文本（如 “吃了200g米饭和100g西兰花”），调用 DeepSeek 估算营养数据。
 *
 * Prompt 契约：每项对象严格匹配
 *   { food_name, estimated_calories, macronutrients{protein_g,fat_g,carbs_g}, confidence_score }
 *   服务端归一化为前端 records 字段（food/calories/protein_g/fat_g/carbs_g/confidence）。
 *
 * 请求体: { text: string, meal_type?: string }
 * 响应:
 *   {
 *     count: number,
 *     records: FoodRecord[],   // 兼容旧前端结构
 *     items: FoodRecord[],     // 与 records 同构的别名
 *     totalKcal, totalProtein, totalFat, totalCarbs: number,   // 汇总
 *     model: { provider, model, label, switched, attempts }
 *   }
 *
 * 模型配置:
 *   - DEEPSEEK_API_KEY    → DeepSeek（OpenAI 兼容 chat/completions，主调）
 *   - DEEPSEEK_BASE_URL   → 端点覆盖（默认 https://api.deepseek.com）
 *   - DEEPSEEK_MODEL      → 模型覆盖（默认 deepseek-chat）
 *
 * 上线测试期频控：普通用户 24 小时内最多 3 次（429 + 提示文案）；
 * 管理员（管理员 user_id / 有效 x-admin-token）不限次数。
 * 如果未配置或调用失败，返回可诊断错误，绝不回退固定 Mock 数据。
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(request);
  const ua = request.headers.get("user-agent") || "";
  let creditsReserved = false;
  let trialReserved = false;
  let userId = "";

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

    // ── 单 IP 频次限制（Upstash 分布式优先，未配置时回退进程内） ──
    const rl = await rateLimitRequestDistributed(ip);
    if (!rl.allowed) {
      await recordTrafficEvent("blocked", ip);
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

    // ── 单 IP 每日 30 次硬上限（与 analyze-image 对齐，防成本失控） ──
    const daily = await dailyRateLimitRequestDistributed(ip);
    if (!daily.allowed) {
      await recordTrafficEvent("blocked", ip);
      await db.recordVisionLog({
        ip,
        provider: "api",
        label: "TEXT",
        status: 429,
        latency_ms: Date.now() - startTime,
        error: "DAILY_RATE_LIMITED",
      });
      return NextResponse.json(
        {
          detail: "今日分析次数已达上限（30 次/日），请明天再试",
          code: "DAILY_RATE_LIMITED",
          retry_after: daily.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(daily.retryAfterSeconds || 86400) },
        }
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

    userId = await resolveMealUserId(
      String(body?.user_id || request.headers.get("x-user-id") || ""),
      ip
    );

    const localFoodName = findLocalFoodInText(text);
    if (localFoodName && !/[和与,，、及&]/.test(text.replace(localFoodName, ""))) {
      const cached = await getFoodCache([localFoodName]);
      if (cached) {
        const record = cached[0];
        // 本地缓存命中不扣积分：直接回传服务端真实余额，供前端同步
        return NextResponse.json({
          count: 1,
          records: [record],
          items: [record],
          totalKcal: record.calories,
          totalProtein: record.protein_g,
          totalFat: record.fat_g,
          totalCarbs: record.carbs_g,
          remainingCredits: (await db.getCredits(userId)) ?? 0,
          model: { provider: "local", model: "static-food-db", label: "Local Food DB", switched: false, attempts: 0 },
        });
      }
    }

    // ── 管理员判定：频控限额与积分预扣同时豁免（允许无限次调用） ──
    const isAdmin = isAdminRequest(request, userId);

    // ── 上线测试期每日频控：普通用户 3 次 / 24 小时，管理员不限（超限 429） ──
    const trial = await reserveTrialDailyLimit({
      userId,
      ip,
      isAdmin,
      adminToken: request.headers.get("x-admin-token"),
    });
    if (!trial.allowed) {
      await recordTrafficEvent("blocked", ip);
      await db.recordVisionLog({
        ip,
        provider: "waf",
        label: "TEXT",
        status: 429,
        latency_ms: Date.now() - startTime,
        error: "TRIAL_DAILY_LIMIT",
      });
      return NextResponse.json(
        { detail: trial.detail, code: trial.code, retry_after: trial.retryAfter },
        { status: 429, headers: { "Retry-After": String(trial.retryAfter || 86400) } }
      );
    }
    trialReserved = true;
    // 每日请求分类统计：通过全部闸门的文本分析量（best-effort，绝不影响主流程）
    await recordTrafficEvent("text", ip);

    let remainingCredits = 0;
    if (isAdmin) {
      // 管理员：跳过积分预扣（与频控豁免一致），返回真实余额供前端同步
      remainingCredits = (await db.getCredits(userId)) ?? 0;
    } else {
      const creditGuard = await reserveMealCredit(userId, ip);
      if (!creditGuard.allowed) {
        if (trialReserved) {
          await releaseTrialDailyLimit(userId, ip);
          trialReserved = false;
        }
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
      remainingCredits = creditGuard.remaining ?? 0;
    }

    const apiKey = deepSeekApiKey();
    if (!apiKey) {
      console.warn("[Text] No API key configured (DEEPSEEK_API_KEY)");
      if (creditsReserved) {
        await refundMealCredit(userId);
        creditsReserved = false;
      }
      if (trialReserved) {
        await releaseTrialDailyLimit(userId, ip);
        trialReserved = false;
      }
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
          error: "未配置 AI 文本密钥（DEEPSEEK_API_KEY），无法分析",
          detail: "未配置 AI 文本密钥（DEEPSEEK_API_KEY），无法分析",
          code: "NO_TEXT_KEY",
        },
        { status: 503 }
      );
    }

    try {
      const result = await analyzeTextWithDeepSeek(text, mealType, apiKey);
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
      return NextResponse.json({ ...payload, remainingCredits });
    } catch (err: any) {
      const isParseError = /无法解析/.test(err?.message || "");
      if (creditsReserved) {
        await refundMealCredit(userId);
        creditsReserved = false;
      }
      if (trialReserved) {
        await releaseTrialDailyLimit(userId, ip);
        trialReserved = false;
      }
      console.error(
        `[Text] DeepSeek API failed (${isParseError ? "PARSE_ERROR" : "PROVIDER_ERROR"}):`,
        err?.message || err
      );
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
    if (trialReserved) {
      await releaseTrialDailyLimit(userId, ip);
      trialReserved = false;
    }
    console.error("[Text Error]", error);
    await db.recordVisionLog({
      ip,
      provider: "api",
      label: "TEXT",
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

// ─── 提供商封装（与 analyze-image 同构，文本版） ──────────────────────

type TextProviderName = "deepseek";

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
  deepseek: "DeepSeek",
};

function buildModelLabel(provider: TextProviderName, model: string): string {
  return `${PROVIDER_DISPLAY[provider]} (${model})`;
}

/** 构造文字分析提示词（来自套娃应用统一配置 app-config，克隆时按应用替换） */
function buildTextPrompt(text: string, mealType: string): string {
  return APP_CONFIG.prompts.text(text, mealType);
}

/**
 * DeepSeek 主调（OpenAI 兼容 chat/completions）：模型默认 APP_CONFIG.models.text
 * （deepseek-chat），可用 DEEPSEEK_MODEL 覆盖；端点由 DEEPSEEK_BASE_URL 决定。
 */
async function analyzeTextWithDeepSeek(
  text: string,
  mealType: string,
  apiKey: string
): Promise<TextAnalysisResult> {
  const model = resolveDeepSeekModel("text");
  const endpoint = deepSeekChatEndpoint();

  // ── 付费 API 自动节省 Token 模式（本地模型自动豁免、全量放开） ──
  // 云端付费：max_tokens=1000 / temperature=0.2 / System Prompt 追加极简强约束；
  // 本地服务：不注入任何上限，允许完整思维链与详细解析。
  const policy = currentTokenPolicy(endpoint);
  const systemInstruction = guardSystemPrompt(policy);
  logTokenGuard(policy);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
    body: JSON.stringify(
      guardDeepSeekParams(
        {
          model,
          stream: false,
          messages: [
            ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
            { role: "user", content: buildTextPrompt(text, mealType) },
          ],
        },
        policy
      )
    ),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`DeepSeek API ${response.status}: ${errText.slice(0, 200)}`);
  }
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content || "[]";
  const records = parseFoodRecords(raw);
  return {
    count: records.length,
    records,
    model: { provider: "deepseek", model, label: buildModelLabel("deepseek", model), switched: false },
  };
}

/** 稳健解析 AI 返回的食物 JSON（纯数组 / 代码块 / 对象包装 / 夹带文字） */
function parseFoodRecords(text: string): FoodRecord[] {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

  const isFoodLike = (value: any): boolean =>
    !!(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value.food_name || value.food || value.name || value.estimated_calories || value.calories)
    );

  const tryParse = (raw: string): any[] | null => {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        for (const key of ["records", "items", "foods"]) {
          if (Array.isArray(parsed[key])) return parsed[key];
        }
        // 单对象兜底：模型可能只返回一个食物对象（含 food_name / estimated_calories 等主契约字段）
        if (isFoodLike(parsed)) return [parsed];
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
      .map((raw) => {
        // 主契约嵌套结构 macronutrients.{protein_g,fat_g,carbs_g}
        const macros =
          raw.macronutrients && typeof raw.macronutrients === "object" ? raw.macronutrients : {};
        return {
          food: String(raw.food ?? raw.name ?? raw.food_name ?? raw.food_en ?? "未知"),
          food_en: String(raw.food_en ?? raw.name_en ?? ""),
          grams: toNum(raw.grams ?? raw.gram ?? raw.weight_g ?? raw.weight ?? raw.estimated_weight_g),
          calories: toNum(raw.estimated_calories ?? raw.calories ?? raw.cal ?? raw.kcal ?? raw.calorie),
          protein_g: toNum(macros.protein_g ?? macros.protein ?? raw.protein_g ?? raw.protein),
          fat_g: toNum(macros.fat_g ?? macros.fat ?? raw.fat_g ?? raw.fat),
          carbs_g: toNum(
            macros.carbs_g ?? macros.carbs ?? raw.carbs_g ?? raw.carbs ?? raw.carbohydrates_g ?? raw.carbohydrates
          ),
          confidence:
            raw.confidence != null
              ? toNum(raw.confidence)
              : raw.confidence_score != null
                ? toNum(raw.confidence_score)
                : null,
        };
      });

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
