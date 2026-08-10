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

  /** 统一 AI Prompt 工厂（按应用切换，网关 PROMPTS 表与此保持一致） */
  prompts: {
    /** 识图 Prompt：返回 JSON 数组（food/food_en/grams/calories/protein_g/fat_g/carbs_g/confidence） */
    image: (mealType: string): string =>
      `你是一位专业的营养师。请分析这张食物照片，返回 JSON 数组格式的食物列表。
每个对象必须包含: food(中文名), food_en(英文名), grams(估算重量克数), calories(卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
餐次类型: ${mealType}
只返回 JSON 数组，不要其他文字。`,

    /** 文字分析 Prompt：根据用户描述估算营养（返回 JSON 数组） */
    text: (text: string, mealType: string): string =>
      `你是一位专业的营养师。请根据用户的食物描述文本，估算每种食物的营养数据，返回 JSON 数组格式的食物列表。
每个对象必须包含: food(中文名), food_en(英文名), grams(估算重量克数), calories(卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
餐次类型: ${mealType}
用户描述: ${text}
只返回 JSON 数组，不要其他文字。`,
  },

  /** 品牌主题配色（前端高亮/强调色，克隆时替换） */
  theme: {
    primary: "#fbbf24", // 主色（金色系，如品牌按钮/高亮）
    primaryDark: "#f59e0b",
    accent: "#60a5fa", // 辅色（信息/链接）
  },
};
