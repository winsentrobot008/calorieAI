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
   * AI 模型默认值（DeepSeek 已移除，统一使用 Google Gemini 低成本模型）。
   * 值必须是裸模型 ID（如 "gemini-2.5-flash"），严禁带 "models/" 前缀，
   * 否则会拼出 /v1beta/models/models/gemini-2.5-flash 双路径导致 API 404。
   */
  models: {
    /** 识图模型：gemini-2.5-flash（原生多模态，单次调用完成食物识别 + 营养 JSON） */
    vision: "gemini-2.5-flash",
    /** 文字分析模型 */
    text: "gemini-2.5-flash",
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
 * 规范化 Gemini 模型 ID：剥离可能误配的 "models/" / "v1beta/models/" 前缀
 * （可多次出现）与 ":generateContent" 后缀，确保请求 URL 恒为
 * /v1beta/models/<model>:generateContent，杜绝双 /models/ 404 与拼错 URL。
 * 空值/纯空白时回退默认低成本视觉模型 gemini-2.5-flash。
 */
export function normalizeGeminiModel(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^(?:v1beta\/)?(?:models\/)+/, "")
    .replace(/:generateContent$/, "");
  return cleaned || "gemini-2.5-flash";
}
