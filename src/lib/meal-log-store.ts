/**
 * meal-log-store — 当日餐食记录（Cal AI Meal Scan → Save to Log）
 *
 * 本地持久化按日期分组：早餐 / 午餐 / 晚餐 / 加餐。
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealLogItem {
  name: string;
  grams: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
}

export interface MealEntry {
  id: string;
  mealType: MealType;
  ts: string;
  items: MealLogItem[];
  totalKcal: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
}

const LOG_KEY = "calorieai_meal_log";

type LogStore = Record<string, MealEntry[]>;

function readStore(): LogStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeStore(store: LogStore): void {
  localStorage.setItem(LOG_KEY, JSON.stringify(store));
}

export function todayKey(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function getTodayEntries(): MealEntry[] {
  return readStore()[todayKey()] || [];
}

export function addMealEntry(entry: Omit<MealEntry, "id" | "ts">): MealEntry {
  const full: MealEntry = {
    ...entry,
    id: `meal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ts: new Date().toISOString(),
  };
  const store = readStore();
  const key = todayKey();
  const list = store[key] || [];
  list.push(full);
  store[key] = list.slice(-50);
  writeStore(store);
  return full;
}

export function removeMealEntry(id: string): void {
  const store = readStore();
  const key = todayKey();
  store[key] = (store[key] || []).filter((e) => e.id !== id);
  writeStore(store);
}

export function getTodayTotals(): {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
} {
  const entries = getTodayEntries();
  return entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.totalKcal,
      protein: acc.protein + e.totalProtein,
      fat: acc.fat + e.totalFat,
      carbs: acc.carbs + e.totalCarbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );
}

export function entriesByMeal(entries: MealEntry[]): Record<MealType, MealEntry[]> {
  return {
    breakfast: entries.filter((e) => e.mealType === "breakfast"),
    lunch: entries.filter((e) => e.mealType === "lunch"),
    dinner: entries.filter((e) => e.mealType === "dinner"),
    snack: entries.filter((e) => e.mealType === "snack"),
  };
}
