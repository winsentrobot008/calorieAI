import { createHash } from "node:crypto";

export interface CachedFoodRecord {
  food: string;
  food_en: string;
  grams: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  confidence: number | null;
}

const LOCAL_FOOD_DB: Record<string, Omit<CachedFoodRecord, "food">> = {
  apple: { food_en: "apple", grams: 100, calories: 52, protein_g: 0.3, fat_g: 0.2, carbs_g: 14, confidence: 0.98 },
  banana: { food_en: "banana", grams: 100, calories: 89, protein_g: 1.1, fat_g: 0.3, carbs_g: 22.8, confidence: 0.98 },
  rice: { food_en: "rice", grams: 100, calories: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28.2, confidence: 0.98 },
  egg: { food_en: "egg", grams: 50, calories: 72, protein_g: 6.3, fat_g: 4.8, carbs_g: 0.4, confidence: 0.98 },
  chicken: { food_en: "chicken", grams: 100, calories: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0, confidence: 0.97 },
  beef: { food_en: "beef", grams: 100, calories: 250, protein_g: 26, fat_g: 15, carbs_g: 0, confidence: 0.96 },
  pork: { food_en: "pork", grams: 100, calories: 242, protein_g: 27, fat_g: 14, carbs_g: 0, confidence: 0.96 },
  fish: { food_en: "fish", grams: 100, calories: 136, protein_g: 22, fat_g: 5, carbs_g: 0, confidence: 0.95 },
  salmon: { food_en: "salmon", grams: 100, calories: 208, protein_g: 20, fat_g: 13, carbs_g: 0, confidence: 0.97 },
  potato: { food_en: "potato", grams: 100, calories: 87, protein_g: 1.9, fat_g: 0.1, carbs_g: 20.1, confidence: 0.97 },
  tomato: { food_en: "tomato", grams: 100, calories: 18, protein_g: 0.9, fat_g: 0.2, carbs_g: 3.9, confidence: 0.98 },
  broccoli: { food_en: "broccoli", grams: 100, calories: 34, protein_g: 2.8, fat_g: 0.4, carbs_g: 7, confidence: 0.98 },
  carrot: { food_en: "carrot", grams: 100, calories: 41, protein_g: 0.9, fat_g: 0.2, carbs_g: 9.6, confidence: 0.98 },
  bread: { food_en: "bread", grams: 30, calories: 80, protein_g: 2.7, fat_g: 1, carbs_g: 15, confidence: 0.97 },
  milk: { food_en: "milk", grams: 240, calories: 122, protein_g: 8.1, fat_g: 4.8, carbs_g: 12, confidence: 0.97 },
  yogurt: { food_en: "yogurt", grams: 100, calories: 61, protein_g: 3.5, fat_g: 3.3, carbs_g: 4.7, confidence: 0.97 },
  oatmeal: { food_en: "oatmeal", grams: 100, calories: 68, protein_g: 2.4, fat_g: 1.4, carbs_g: 12, confidence: 0.96 },
  tofu: { food_en: "tofu", grams: 100, calories: 76, protein_g: 8, fat_g: 4.8, carbs_g: 1.9, confidence: 0.96 },
  orange: { food_en: "orange", grams: 100, calories: 47, protein_g: 0.9, fat_g: 0.1, carbs_g: 11.8, confidence: 0.98 },
  avocado: { food_en: "avocado", grams: 100, calories: 160, protein_g: 2, fat_g: 14.7, carbs_g: 8.5, confidence: 0.97 },
};

const ALIASES: Record<string, string> = {
  苹果: "apple", 香蕉: "banana", 米饭: "rice", 大米: "rice", 鸡蛋: "egg", 蛋: "egg",
  鸡肉: "chicken", 牛肉: "beef", 猪肉: "pork", 鱼: "fish", 三文鱼: "salmon", 土豆: "potato",
  番茄: "tomato", 西红柿: "tomato", 西兰花: "broccoli", 胡萝卜: "carrot", 面包: "bread",
  牛奶: "milk", 酸奶: "yogurt", 燕麦: "oatmeal", 豆腐: "tofu", 橙子: "orange", 牛油果: "avocado",
};

function canonicalName(name: string): string {
  const normalized = name.trim().toLowerCase();
  return ALIASES[normalized] || normalized;
}

export function foodNamesHash(foodNames: string[]): string {
  const normalized = foodNames.map(canonicalName).filter(Boolean).sort().join(",");
  return createHash("md5").update(normalized).digest("hex");
}

async function redisCommand<T>(command: string[]): Promise<T | null> {
  const url = process.env.KV_REST_API_URL || process.env.VERCEL_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.VERCEL_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(`${url}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Redis command failed: ${response.status}`);
  return ((await response.json()) as { result?: T }).result ?? null;
}

export async function getFoodCache(foodNames: string[]): Promise<CachedFoodRecord[] | null> {
  const names = foodNames.map(canonicalName).filter(Boolean);
  if (!names.length) return null;
  const key = `calorieai:food-cache:${foodNamesHash(names)}`;
  const cached = await redisCommand<string>(["GET", key]);
  if (cached) return JSON.parse(cached) as CachedFoodRecord[];
  if (names.length !== 1) return null;
  const local = LOCAL_FOOD_DB[names[0]];
  return local ? [{ food: names[0], ...local }] : null;
}

export async function setFoodCache(foodNames: string[], records: CachedFoodRecord[]): Promise<void> {
  const key = `calorieai:food-cache:${foodNamesHash(foodNames)}`;
  await redisCommand(["SET", key, JSON.stringify(records), "EX", "2592000"]);
}

export function lookupLocalFood(foodName: string): CachedFoodRecord | null {
  const name = canonicalName(foodName);
  const food = LOCAL_FOOD_DB[name];
  return food ? { food: name, ...food } : null;
}

export function findLocalFoodInText(text: string): string | null {
  const normalized = text.toLowerCase();
  const match = Object.keys(LOCAL_FOOD_DB).find((name) => {
    const alias = Object.entries(ALIASES).find(([, value]) => value === name)?.[0];
    return normalized.includes(name) || (alias ? text.includes(alias) : false);
  });
  return match || null;
}