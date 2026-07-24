import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id") || "anonymous";

  return NextResponse.json({
    user: {
      id: userId,
      name: "User",
      goal_type: "maintain",
      daily_calories: 2000,
      daily_protein: 60,
      daily_fat: 65,
      daily_carbs: 300,
    },
  });
}

export async function PUT(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return NextResponse.json({ status: "ok", message: "Profile updated" });
}
