import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    users: [
      {
        id: "user_001",
        name: "Test User",
        email: "test@example.com",
        subscription_status: "active",
        subscription_plan: "monthly",
        license_type: null,
        daily_free_uses: 1,
        ad_reward_credits: 0,
        is_active: true,
      },
    ],
  });
}
