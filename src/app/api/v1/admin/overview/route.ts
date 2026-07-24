import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    overview: {
      total_users: 128,
      today_recognitions: 45,
      weekly_recognitions: 312,
      active_subscriptions: 23,
      permanent_licenses: 7,
      model_calls_24h: 892,
      error_rate_pct: 1.2,
      model_errors_24h: 11,
      total_revenue: 4599.5,
    },
  });
}
