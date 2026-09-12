import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db, addServerCredits } from "@/lib/db";
import { getAdminAuth } from "@/lib/admin-auth";

/**
 * GET /api/v1/user/credits?user_id=xxx
 *
 * 返回服务器持久化的积分余额与 Pro 状态。
 * 冷启动 / 跨设备访问时，前端以此为准保证积分与权限完全一致。
 *
 * 只读语义：绝不隐式创建账号或赠送免费额度，账号不存在时返回 0。
 * 首次赠送只在登录 / 注册（受 Turnstile 与人机校验保护）时发生。
 */
export async function GET(request: NextRequest) {
  const userId = new URL(request.url).searchParams.get("user_id") || "anonymous";
  const credits = (await db.getCredits(userId)) ?? 0;
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
 * 返回服务器最新余额。
 *
 * 安全约束（防刷分）：
 *   1. 增值写入（delta > 0）仅允许服务端可信调用方：携带 x-internal-secret
 *      （INTERNAL_API_SECRET）的内部调用，或持有有效管理员会话令牌（x-admin-token）；
 *      支付入账走 Stripe / PayPal Webhook，广告奖励走 /api/v1/billing/ad-reward。
 *   2. 非可信调用方只能对「已存在账号」做扣减，禁止借新账号初始化顺带获得赠送额度。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = String(body.user_id || "").trim();
    const delta = Number(body.delta);
    if (!userId) {
      return NextResponse.json({ error: "缺少 user_id" }, { status: 400 });
    }
    if (!Number.isFinite(delta)) {
      return NextResponse.json({ error: "delta 必须为数字" }, { status: 400 });
    }

    const trusted = isTrustedCaller(request);
    if (delta > 0 && !trusted) {
      return NextResponse.json(
        { error: "CREDIT_GRANT_FORBIDDEN", detail: "积分发放仅限服务端内部调用" },
        { status: 403 }
      );
    }
    if (!trusted && (await db.getCredits(userId)) === null) {
      return NextResponse.json(
        { error: "ACCOUNT_NOT_FOUND", detail: "账号不存在或尚未登录" },
        { status: 404 }
      );
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

/**
 * 服务端可信调用方判定：内部密钥（x-internal-secret）或有效管理员会话（x-admin-token）。
 * 使用定时安全比较，避免密钥比对被时间侧信道推断。
 */
function isTrustedCaller(request: NextRequest): boolean {
  const expected = (process.env.INTERNAL_API_SECRET || "").trim();
  const provided = (request.headers.get("x-internal-secret") || "").trim();
  if (expected && provided && expected.length === provided.length) {
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return true;
  }
  return getAdminAuth(request).ok;
}
