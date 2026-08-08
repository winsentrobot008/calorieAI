import { NextResponse } from "next/server";
import { getAllSubscriptions } from "@/lib/billing-store";

export async function GET() {
  return NextResponse.json({
    users: getAllSubscriptions().map((sub) => ({
      id: sub.user_id,
      name: sub.email ? sub.email.split("@")[0] : sub.user_id,
      email: sub.email || sub.user_id,
      subscription_status: sub.is_active ? "active" : "inactive",
      subscription_plan: sub.plan,
      license_type: sub.is_permanent ? "permanent" : null,
      provider: sub.provider,
      current_period_end: sub.current_period_end,
      is_active: sub.is_active,
    })),
  });
}
