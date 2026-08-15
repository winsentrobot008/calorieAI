import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { stableUserId } from "@/lib/user-identity";
import { db, initCreditsIfMissing } from "@/lib/db";

/**
 * POST /api/v1/auth/login
 *
 * 登录（Cloudflare Turnstile 人机校验 + 温和限频）。
 * Demo 登录语义：任意邮箱 + 密码 ≥4 位即通过（与服务端真库积分绑定）。
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limit = checkRateLimit(`login:${ip}:60s`, 10, 60_000);
  if (!limit.allowed) {
    const retryAfterSec = Math.ceil((limit.retryAfterMs || 0) / 1000);
    return NextResponse.json(
      { error: `尝试过于频繁，请 ${retryAfterSec} 秒后重试`, retry_after: retryAfterSec },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = (body.email || "").toString().trim();
  const password = (body.password || "").toString();
  const humanToken = (body.human_token || "").toString();

  if (!email || !password) {
    return NextResponse.json({ detail: "请提供邮箱和密码" }, { status: 400 });
  }

  const human = await verifyTurnstileToken(humanToken, ip);
  if (!human.ok) {
    return NextResponse.json({ error: human.error }, { status: 403 });
  }

  const userId = stableUserId(email);
  const credits = await initCreditsIfMissing(userId);
  const sub = await db.getSubscription(userId);
  return NextResponse.json({
    user_id: userId,
    email,
    name: email.split("@")[0] || "User",
    credits,
    is_pro: !!sub?.is_active,
  });
}
