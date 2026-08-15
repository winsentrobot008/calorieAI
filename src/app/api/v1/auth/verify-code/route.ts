import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  verifyOtp,
  createEmailVerifiedToken,
} from "@/lib/email-verify";

/**
 * POST /api/v1/auth/verify-code
 *
 * 校验邮箱 OTP，通过后签发 email_verified_token 供注册接口绑定。
 * 单 IP 60 秒内最多 10 次尝试，防止暴力枚举验证码（单码另有 5 次尝试上限）。
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const limit = checkRateLimit(`verify-code:${ip}:60s`, 10, 60_000);
  if (!limit.allowed) {
    const retryAfterSec = Math.ceil((limit.retryAfterMs || 0) / 1000);
    return NextResponse.json(
      { error: `尝试过于频繁，请 ${retryAfterSec} 秒后重试`, retry_after: retryAfterSec },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = (body.email || "").toString().trim();
  const code = (body.code || "").toString().trim();

  if (!email || !code) {
    return NextResponse.json({ error: "请提供邮箱与验证码" }, { status: 400 });
  }

  const result = await verifyOtp(email, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const token = await createEmailVerifiedToken(email);
  return NextResponse.json({ ok: true, email, email_verified_token: token });
}
