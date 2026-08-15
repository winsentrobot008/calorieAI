import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { consumeEmailVerifiedToken, isValidEmail, isDisposableEmail } from "@/lib/email-verify";
import { stableUserId } from "@/lib/user-identity";
import { db, initCreditsIfMissing } from "@/lib/db";

/**
 * POST /api/v1/auth/register
 *
 * 邮箱注册（必须已通过 OTP 邮箱验证）：
 *   - Cloudflare Turnstile 人机校验；
 *   - 单 IP 60 秒内 1 次、每小时最多 5 次；
 *   - email_verified_token 绑定邮箱，阻断脚本伪造注册；
 *   - 一次性临时邮箱黑名单兜底。
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  const short = checkRateLimit(`register:${ip}:60s`, 1, 60_000);
  const hour = checkRateLimit(`register:${ip}:3600s`, 5, 3_600_000);
  if (!short.allowed || !hour.allowed) {
    const retryAfterSec = Math.max(
      Math.ceil((short.retryAfterMs || 0) / 1000),
      Math.ceil((hour.retryAfterMs || 0) / 1000)
    );
    return NextResponse.json(
      { error: `请求过于频繁，请 ${retryAfterSec} 秒后重试`, retry_after: retryAfterSec },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = (body.email || "").toString().trim();
  const password = (body.password || "").toString();
  const name = (body.name || email.split("@")[0] || "User").toString();
  const humanToken = (body.human_token || "").toString();
  const verifiedToken = (body.email_verified_token || "").toString();

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (isDisposableEmail(email)) {
    return NextResponse.json(
      { error: "不支持一次性临时邮箱，请使用真实邮箱" },
      { status: 400 }
    );
  }
  if (password.length < 4) {
    return NextResponse.json({ error: "密码长度至少 4 位" }, { status: 400 });
  }

  const human = await verifyTurnstileToken(humanToken, ip);
  if (!human.ok) {
    return NextResponse.json({ error: human.error }, { status: 403 });
  }

  const verified = await consumeEmailVerifiedToken(email, verifiedToken);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  const userId = stableUserId(email);
  const credits = await initCreditsIfMissing(userId);
  const sub = await db.getSubscription(userId);
  console.log(`[Auth Register] 邮箱已验证并注册成功: ${email} → ${userId}`);
  return NextResponse.json({
    user_id: userId,
    email,
    name,
    credits,
    is_pro: !!sub?.is_active,
  });
}
