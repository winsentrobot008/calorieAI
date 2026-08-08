import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const subs = await db.getAllSubscriptions();
  return NextResponse.json({
    users: subs.map((sub) => ({
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
