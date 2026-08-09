import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { getPaymentStats } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth.ok) return auth.response;

  const stats = await getPaymentStats();
  return NextResponse.json({
    total_revenue: stats.total_revenue,
    breakdown: { subscription: stats.subscription_revenue, license: stats.license_revenue },
    plan_breakdown: stats.plan_breakdown,
    invoice_count: stats.count,
    recent_payments: stats.recent_payments,
  });
}
