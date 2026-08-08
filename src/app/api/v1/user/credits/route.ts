import { NextRequest, NextResponse } from "next/server";
import { db, initCreditsIfMissing, addServerCredits } from "@/lib/db";

/**
 * GET /api/v1/user/credits?user_id=xxx
 *
 * 返回服务器持久化的积分余额与 Pro 状态。
 * 冷启动 / 跨设备访问时，前端以此为准保证积分与权限完全一致。
 */
export async function GET(request: NextRequest) {
  const userId = new URL(request.url).searchParams.get("user_id") || "anonymous";
  const credits = await initCreditsIfMissing(userId);
  const sub = await db.getSubscription(userId);
  return NextResponse.json({ credits, is_pro: !!sub?.is_active, user_id: userId });
}

/**
 * POST /api/v1/user/credits
 *
 * Body: { user_id: string, delta: number, action?: "ad" | "recognition" | "purchase" | "manual" }
 * 增减积分（广告 +10 / 识图 -1 / 充值 +10），返回服务器最新余额。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = body.user_id || "anonymous";
    const delta = Number(body.delta);
    if (!Number.isFinite(delta)) {
      return NextResponse.json({ error: "delta 必须为数字" }, { status: 400 });
    }

    const credits = await addServerCredits(userId, delta);
    const sub = await db.getSubscription(userId);
    console.log(`[Credits API] user=${userId} delta=${delta} → credits=${credits} action=${body.action || "manual"}`);
    return NextResponse.json({ credits, is_pro: !!sub?.is_active, user_id: userId });
  } catch (error: any) {
    console.error("[Credits API Error]", error);
    return NextResponse.json({ error: error.message || "积分同步失败" }, { status: 500 });
  }
}
