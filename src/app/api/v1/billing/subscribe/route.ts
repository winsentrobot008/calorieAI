import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const plan = searchParams.get("plan");

  return NextResponse.json({
    status: "ok",
    message: `订阅成功 (${plan})`,
    subscription_id: `sub_${Date.now()}`,
  });
}
