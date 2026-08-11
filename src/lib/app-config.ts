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
    /**
     * 识图 Prompt：全量清点（Count）+ 强制总数（Total）+ 带数量命名。
     * 返回 JSON 数组：food(带数量中文名)/food_en/grams(整盘总量)/calories/protein_g/fat_g/carbs_g(整盘总量)/confidence。
     */
    image: (mealType: string): string =>
      `你是一位专业的营养师。请对这张食物照片执行【自动数数 + 数量明确展示 + 整盘总热量计算】。

规则（必须严格遵守）：
1. 强制清点数量 Count：必须清点画面中所有可见食物的具体数量/份数（如「9 颗小笼包」「3 块炸鸡」「1 碗米饭」「2 个鸡蛋」）。画面模糊无法确定时给出合理估计，并在 confidence(0-1) 中体现置信度。
2. 食物名称带数量与预估总重：food 名称必须同时包含数量与整盘预估总重，如「小笼包 (9 颗 / 约 270g)」「炸鸡 (3 块 / 约 240g)」「米饭 (1 碗 / 约 300g)」，让用户一眼看懂整盘份量。
3. 计算总账 Total：每项 kcal / P(蛋白质) / F(脂肪) / C(碳水) 必须是画面中【所有数量的总和】（单品 × 总数量），直接输出整盘/整笼的【实际总热量与总营养素】；绝不能只给单颗/单份或 100g 基础单位的数据。

输出 JSON 数组，每个对象必须包含：
food(带数量与总重的中文名，如「小笼包 (9 颗 / 约 270g)」), food_en(英文名), grams(该食物整盘估算总重量克数), calories(该食物整盘总卡路里=单品×数量), protein_g(整盘蛋白质克数), fat_g(整盘脂肪克数), carbs_g(整盘碳水克数), confidence(0-1的置信度).
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
