import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  return NextResponse.json({
    is_premium: false,
    is_permanent: false,
    remaining_daily_recognitions: 3,
    daily_free_uses: 3,
    ad_reward_credits: 0,
    free_tier: true,
  });
}
