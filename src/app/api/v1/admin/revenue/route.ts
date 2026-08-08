import { NextResponse } from "next/server";
import { getPaymentStats } from "@/lib/billing-store";

export async function GET() {
  const stats = getPaymentStats();
  return NextResponse.json({
    total_revenue: stats.total_revenue,
    breakdown: { subscription: stats.subscription_revenue, license: stats.license_revenue },
    plan_breakdown: stats.plan_breakdown,
    invoice_count: stats.count,
    recent_payments: stats.recent_payments,
  });
}
