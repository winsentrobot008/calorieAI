import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    total_revenue: 4599.5,
    breakdown: { subscription: 3599.5, license: 1000 },
    plan_breakdown: { monthly: 1200, yearly: 2399.5, permanent: 1000 },
    invoice_count: 45,
  });
}
