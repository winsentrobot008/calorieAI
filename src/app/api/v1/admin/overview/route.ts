import { NextResponse } from "next/server";
import { getPaymentStats, getActiveSubscriptionCount, getPermanentLicenseCount, getAllSubscriptions } from "@/lib/billing-store";
import { getVisionStats } from "@/lib/vision-log-store";
import { getVisitStats } from "@/lib/analytics-store";

export async function GET() {
  const payments = getPaymentStats();
  const vision = getVisionStats();
  const visits = getVisitStats();
  const subscriptions = getAllSubscriptions();

  return NextResponse.json({
    overview: {
      total_users: subscriptions.length + 1,
      total_visits: visits.total_visits,
      today_recognitions: vision.today_calls,
      model_calls: vision.total_calls,
      active_subscriptions: getActiveSubscriptionCount(),
      permanent_licenses: getPermanentLicenseCount(),
      error_rate_pct: vision.error_rate_pct,
      model_errors: vision.errors,
      total_revenue: payments.total_revenue,
    },
  });
}
