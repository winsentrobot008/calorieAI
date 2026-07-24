import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: "ok",
    stats: {
      calories: 541,
      protein_g: 52.8,
      fat_g: 6.3,
      carbs_g: 65,
      meal_count: 3,
    },
    goals: {
      daily_calories: 2000,
      daily_protein: 60,
      daily_fat: 65,
      daily_carbs: 300,
      goal_type: "maintain",
    },
  });
}
