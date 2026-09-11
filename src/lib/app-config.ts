/**
 * app-config — 套娃应用统一配置（Template Convergence）
 *
 * 克隆新套娃应用时，只需修改本文件 + i18n 品牌文案 + 主题配色：
 *   1. appId   → 网关注册 ID（如 "petai"）；
 *   2. appName → 品牌名（如 "PetAI"）；
 *   3. prompts → 按应用切换的 AI Prompt（识图 / 文字分析）；
 *   4. theme   → 品牌主色（UI 高亮/按钮/图表强调色）。
 * 其余代码（网关 SDK、积分、收银、DAL、管理后台、QA）零改动即可复用。
 */

export const APP_CONFIG = {
  /** 网关注册 App-ID（GATEWAY_APP_TOKENS 键名，必须与网关一致） */
  appId: "calorieai",
  /** 品牌名（用于日志 / 支付商品名 / 页面标题） */
  appName: "CalorieAI",
  /** 中文品牌名 */
  appNameZh: "卡路里助手",

  /**
   * AI 主调 Provider：DeepSeek 官方 API（OpenAI 兼容 chat/completions）。
   *   - 密钥：DEEPSEEK_API_KEY
   *   - 端点：DEEPSEEK_BASE_URL（默认 https://api.deepseek.com，可含 /v1）
   * 识图与文字分析统一走该端点；Gemini 仅作为识图的可选兜底。
   */
  ai: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    /** OpenAI 兼容补全路径（base 已含 /v1 时拼接结果同样正确） */
    chatPath: "/chat/completions",
  },

  /**
   * AI 模型默认值（DeepSeek 主调）。
   * 值必须是裸模型 ID（如 "deepseek-chat"），严禁带 provider 前缀。
   */
  models: {
    /** 识图模型：deepseek-chat（可用 DEEPSEEK_VISION_MODEL 覆盖为多模态模型） */
    vision: "deepseek-chat",
    /** 文字分析模型 */
    text: "deepseek-chat",
  },

  /** 统一 AI Prompt 工厂（按应用切换，网关 PROMPTS 表与此保持一致） */
  prompts: {
    /**
     * 识图 Prompt（精简版，极大压减 Input Tokens）：
     * 明确结构化 JSON schema（food_name / estimated_calories /
     * macronutrients / confidence_score）与格式约束，禁止冗余解释与 Markdown。
     */
    image: (mealType: string): string =>
      `分析食物照片，清点食物并估算整盘营养。餐次:${mealType}。
只返回 JSON 数组，每项对象必须严格匹配以下 schema：
{
  "food_name": "食物名（含数量与整盘总重，如 \"小笼包 (9 颗 / 约 270g)\"）",
  "estimated_calories": 整盘总热量（单品×数量）,
  "macronutrients": { "protein_g": 整盘蛋白质g, "fat_g": 整盘脂肪g, "carbs_g": 整盘碳水g },
  "confidence_score": 0~1 置信度
}
可选字段（不得影响主契约）：food_en（英文名）、grams（整盘总克数）。
只返回 JSON，禁止 Markdown 代码块与任何额外文字。`,

    /**
     * 文字分析 Prompt（精简版）：根据用户描述估算营养。
     * 同样要求结构化 JSON schema（food_name / estimated_calories /
     * macronutrients / confidence_score），返回 JSON 数组。
     */
    text: (text: string, mealType: string): string =>
      `估算用户食物描述的营养。餐次:${mealType}，描述:${text}。
只返回 JSON 数组，每项对象必须严格匹配以下 schema：
{
  "food_name": "食物名",
  "estimated_calories": 热量kcal,
  "macronutrients": { "protein_g": 蛋白质g, "fat_g": 脂肪g, "carbs_g": 碳水g },
  "confidence_score": 0~1 置信度
}
可选字段（不得影响主契约）：food_en（英文名）、grams（克数）。
只返回 JSON，禁止 Markdown 代码块与任何额外文字。`,
  },

  /** 品牌主题配色（前端高亮/强调色，克隆时替换） */
  theme: {
    primary: "#fbbf24", // 主色（金色系，如品牌按钮/高亮）
    primaryDark: "#f59e0b",
    accent: "#60a5fa", // 辅色（信息/链接）
  },
};

/**
 * 默认兜底模型：低成本原生多模态视觉模型。
 * 同时作为废弃模型 ID 的重定向目标，确保残留旧环境变量不再打向上游 404。
 */
const FALLBACK_GEMINI_MODEL = "gemini-2.5-flash";

/** 显式退役清单：Google 已下线或不可用的模型 ID */
const RETIRED_GEMINI_MODELS = new Set([
  "gemini-pro",
  "gemini-pro-vision",
  "gemini-1.0-pro",
  "gemini-1.0-pro-001",
  "gemini-1.0-pro-vision",
]);

/** 任意 1.5 世代 ID（gemini-1.5-flash / gemini-1.5-flash-002 / gemini-1.5-pro 等） */
const DEPRECATED_GEMINI_GENERATION = /(?:^|[^0-9])1\.5(?:[^0-9]|$)/;

/** 判定废弃模型 ID：命中显式退役清单，或属于 1.5 世代 */
function isRetiredGeminiModel(model: string): boolean {
  const id = model.toLowerCase();
  return RETIRED_GEMINI_MODELS.has(id) || DEPRECATED_GEMINI_GENERATION.test(id);
}

/**
 * 规范化 Gemini 模型 ID：剥离可能误配的 "models/" / "v1beta/models/" 前缀
 * （可多次出现）与 ":generateContent" 后缀，确保请求 URL 恒为
 * /v1beta/models/<model>:generateContent，杜绝双 /models/ 404 与拼错 URL。
 * 空值/纯空白，或命中废弃模型（含 1.5 世代与 1.0 退役清单）时，
 * 一律重定向到 gemini-2.5-flash，彻底免疫旧环境变量冲击。
 */
export function normalizeGeminiModel(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^(?:v1beta\/)?(?:models\/)+/, "")
    .replace(/:generateContent$/, "");
  if (!cleaned || isRetiredGeminiModel(cleaned)) return FALLBACK_GEMINI_MODEL;
  return cleaned;
}

/** DeepSeek 主调端点基址（DEEPSEEK_BASE_URL 覆盖，去掉尾部斜杠） */
export function deepSeekBaseUrl(): string {
  const base = (process.env.DEEPSEEK_BASE_URL || APP_CONFIG.ai.baseUrl).trim();
  return base.replace(/\/+$/, "") || APP_CONFIG.ai.baseUrl;
}

/**
 * DeepSeek OpenAI 兼容补全端点：`<base>/chat/completions`。
 * base 形如 https://api.deepseek.com 或 https://api.deepseek.com/v1 均拼接正确；
 * 若 DEEPSEEK_BASE_URL 已直接写到 /chat/completions 则原样返回。
 */
export function deepSeekChatEndpoint(): string {
  const base = deepSeekBaseUrl();
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}${APP_CONFIG.ai.chatPath}`;
}

/** DeepSeek 密钥（DEEPSEEK_API_KEY）；未配置时返回空串，由路由返回明确错误 */
export function deepSeekApiKey(): string {
  return (process.env.DEEPSEEK_API_KEY || "").trim();
}

/**
 * DeepSeek 模型 ID：DEEPSEEK_MODEL 覆盖文本模型，DEEPSEEK_VISION_MODEL 覆盖识图模型
 * （识图仍回落到 DEEPSEEK_MODEL，再回落 APP_CONFIG.models）。
 */
export function resolveDeepSeekModel(kind: "vision" | "text" = "text"): string {
  const configured =
    kind === "vision"
      ? process.env.DEEPSEEK_VISION_MODEL || process.env.DEEPSEEK_MODEL
      : process.env.DEEPSEEK_MODEL;
  const model = (configured || APP_CONFIG.models[kind]).trim();
  return model || APP_CONFIG.models[kind];
}

/**
 * 识图兜底密钥：DeepSeek 官方 API 暂无多模态识图能力，
 * 配置 GEMINI_API_KEY 时可用 Gemini Vision 兜底（未配置则不兜底，返回明确错误）。
 */
export function visionFallbackApiKey(): string {
  return (process.env.GEMINI_API_KEY || "").trim();
}

/** 识图兜底模型 ID（Gemini Vision，默认 gemini-2.5-flash） */
export function resolveVisionFallbackModel(): string {
  return normalizeGeminiModel(process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "");
}
