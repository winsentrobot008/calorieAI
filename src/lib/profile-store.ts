/**
 * profile-store — 用户画像与 Onboarding 设置（Cal AI Style）
 *
 * 3 步 Onboarding：性别 → 体重与目标 → 每日卡路里目标（自动推荐）。
 * 推荐公式：Mifflin-St Jeor BMR × 活动系数(1.2)，按目标调整
 * （减脂 -400 / 维持 0 / 增肌 +300），最低 1200 kcal。
 */

export type Gender = "male" | "female" | "other";
export type WeightGoal = "lose" | "maintain" | "gain";

export interface UserProfile {
  gender: Gender;
  weightKg: number;
  goal: WeightGoal;
  heightCm?: number;
  age?: number;
  dailyCalories: number;
  onboarded: boolean;
}

const PROFILE_KEY = "calorieai_profile";
export const DEFAULT_DAILY_CALORIES = 2000;

export function getProfile(): UserProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return p as UserProfile;
  } catch {
    return null;
  }
}

export function saveProfile(p: Partial<UserProfile>): UserProfile {
  const current = getProfile() || {
    gender: "other" as Gender,
    weightKg: 70,
    goal: "maintain" as WeightGoal,
    dailyCalories: DEFAULT_DAILY_CALORIES,
    onboarded: false,
  };
  const next: UserProfile = { ...current, ...p };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  return next;
}

export function isOnboarded(): boolean {
  const p = getProfile();
  return !!p?.onboarded;
}

export function markOnboarded(): UserProfile {
  return saveProfile({ onboarded: true });
}

export function calculateRecommendedCalories(input: {
  gender: Gender;
  weightKg: number;
  goal: WeightGoal;
  heightCm?: number;
  age?: number;
}): number {
  const weight = Math.max(30, Number(input.weightKg) || 70);
  const height = Math.max(120, Number(input.heightCm) || 170);
  const age = Math.max(14, Math.min(90, Number(input.age) || 30));
  let bmr: number;
  if (input.gender === "male") {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else if (input.gender === "female") {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  } else {
    bmr = (10 * weight + 6.25 * height - 5 * age + 5 + 10 * weight + 6.25 * height - 5 * age - 161) / 2;
  }
  const tdee = bmr * 1.2; // 久坐轻活动系数
  const adjust = input.goal === "lose" ? -400 : input.goal === "gain" ? 300 : 0;
  return Math.max(1200, Math.round((tdee + adjust) / 10) * 10);
}
