import { NextRequest, NextResponse } from "next/server";
import { db, initCreditsIfMissing, addServerCredits } from "@/lib/db";
import { createGatewayClient } from "@/lib/gateway-client";

// 中央网关接入（可选）：配置 GATEWAY_BASE_URL + GATEWAY_APP_KEY 时，积分经跨端网关统一管理
const gateway = createGatewayClient({
  baseUrl: process.env.GATEWAY_BASE_URL || "",
  appId: "calorieai",
  appKey: process.env.GATEWAY_APP_KEY || "",
});

/**
 * GET /api/v1/user/credits?user_id=xxx
 *
 * 返回服务器持久化的积分余额与 Pro 状态。
 * 冷启动 / 跨设备访问时，前端以此为准保证积分与权限完全一致。
 */
export async function GET(request: NextRequest) {
  const userId = new URL(request.url).searchParams.get("user_id") || "anonymous";
  if (gateway.isConfigured()) {
    try {
      const g = await gateway.getCredits(userId);
      return NextResponse.json({
        credits: g.credits,
        is_pro: g.is_pro,
        status: g.is_pro ? "pro" : "free",
        has_active_subscription: !!g.is_pro,
        user_id: userId,
        via: "gateway",
      });
    } catch (err: any) {
      console.warn("[Credits] 网关查询失败，回退本地:", err.message);
    }
  }
  const credits = await initCreditsIfMissing(userId);
  const sub = await db.getSubscription(userId);
  const isPro = !!sub?.is_active;
  return NextResponse.json({
    credits,
    is_pro: isPro,
    status: isPro ? "pro" : "free",
    has_active_subscription: isPro,
    user_id: userId,
  });
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

    if (gateway.isConfigured()) {
      try {
        const g = await gateway.updateCredits({ user_id: userId, delta });
        return NextResponse.json({
          credits: g.credits,
          is_pro: g.is_pro,
          status: g.is_pro ? "pro" : "free",
          has_active_subscription: !!g.is_pro,
          user_id: userId,
          via: "gateway",
        });
      } catch (err: any) {
        console.warn("[Credits] 网关写入失败，回退本地:", err.message);
      }
    }

    const credits = await addServerCredits(userId, delta);
    const sub = await db.getSubscription(userId);
    const isPro = !!sub?.is_active;
    console.log(`[Credits API] user=${userId} delta=${delta} → credits=${credits} action=${body.action || "manual"}`);
    return NextResponse.json({
      credits,
      is_pro: isPro,
      status: isPro ? "pro" : "free",
      has_active_subscription: isPro,
      user_id: userId,
    });
  } catch (error: any) {
    console.error("[Credits API Error]", error);
    return NextResponse.json({ error: error.message || "积分同步失败" }, { status: 500 });
  }
}
