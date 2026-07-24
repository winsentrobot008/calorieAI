import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    days: [
      { date: "2026-07-18", calories: 1820, protein_g: 65, fat_g: 55, carbs_g: 220, goal_calories: 2000, weekday: "周六", meal_types: { breakfast: 420, lunch: 680, dinner: 720, snack: 0 } },
      { date: "2026-07-19", calories: 1950, protein_g: 70, fat_g: 60, carbs_g: 240, goal_calories: 2000, weekday: "周日", meal_types: { breakfast: 380, lunch: 750, dinner: 820, snack: 0 } },
      { date: "2026-07-20", calories: 1680, protein_g: 55, fat_g: 45, carbs_g: 200, goal_calories: 2000, weekday: "周一", meal_types: { breakfast: 350, lunch: 620, dinner: 710, snack: 0 } },
      { date: "2026-07-21", calories: 2100, protein_g: 75, fat_g: 70, carbs_g: 260, goal_calories: 2000, weekday: "周二", meal_types: { breakfast: 450, lunch: 800, dinner: 850, snack: 0 } },
      { date: "2026-07-22", calories: 1780, protein_g: 60, fat_g: 50, carbs_g: 215, goal_calories: 2000, weekday: "周三", meal_types: { breakfast: 400, lunch: 650, dinner: 730, snack: 0 } },
      { date: "2026-07-23", calories: 1920, protein_g: 68, fat_g: 58, carbs_g: 235, goal_calories: 2000, weekday: "周四", meal_types: { breakfast: 380, lunch: 720, dinner: 820, snack: 0 } },
      { date: "2026-07-24", calories: 541, protein_g: 52.8, fat_g: 6.3, carbs_g: 65, goal_calories: 2000, weekday: "今天", meal_types: { breakfast: 260, lunch: 281, dinner: 0, snack: 0 } },
    ],
  });
}
