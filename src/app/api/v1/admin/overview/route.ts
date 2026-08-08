import { NextResponse } from "next/server";
import { db, getPaymentStats, getVisionStats, getVisitStats } from "@/lib/db";

export async function GET() {
  const [payments, vision, visits, subscriptions] = await Promise.all([
    getPaymentStats(),
    getVisionStats(),
    getVisitStats(),
    db.getAllSubscriptions(),
  ]);

  return NextResponse.json({
    overview: {
      total_users: subscriptions.length + 1,
      total_visits: visits.total_visits,
      today_recognitions: vision.today_calls,
      model_calls: vision.total_calls,
      active_subscriptions: subscriptions.filter((s) => s.is_active).length,
      permanent_licenses: subscriptions.filter((s) => s.is_active && s.is_permanent).length,
      error_rate_pct: vision.error_rate_pct,
      model_errors: vision.errors,
      total_revenue: payments.total_revenue,
    },
  });
}
