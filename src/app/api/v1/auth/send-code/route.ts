import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import {
  createOtp,
  isValidEmail,
  isDisposableEmail,
  sendOtpEmail,
} from "@/lib/email-verify";

/**
 * POST /api/v1/auth/send-code
 *
 * 发送邮箱 OTP 验证码（注册激活前置步骤）。
 * 防刷：
 *   - Cloudflare Turnstile 人机校验；
 *   - 单 IP 60 秒内 1 次、每小时最多 5 次；
 *   - 邮箱格式校验 + 一次性临时邮箱黑名单。
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  // 严格限频：60s/1 + 3600s/5
  const short = checkRateLimit(`send-code:${ip}:60s`, 1, 60_000);
  const hour = checkRateLimit(`send-code:${ip}:3600s`, 5, 3_600_000);
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
  const humanToken = (body.human_token || "").toString();

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (isDisposableEmail(email)) {
    return NextResponse.json(
      { error: "不支持一次性临时邮箱，请使用真实邮箱" },
      { status: 400 }
    );
  }

  const human = await verifyTurnstileToken(humanToken, ip);
  if (!human.ok) {
    return NextResponse.json({ error: human.error }, { status: 403 });
  }

  try {
    const code = await createOtp(email);
    const result = await sendOtpEmail(email, code);
    return NextResponse.json({
      ok: true,
      email,
      sent: result.sent,
      ...(result.devCode ? { dev_code: result.devCode } : {}),
      hint: "验证码 10 分钟内有效",
    });
  } catch (err: any) {
    console.error("[Auth send-code] 发送失败:", err?.message);
    return NextResponse.json({ error: err?.message || "验证码发送失败" }, { status: 500 });
  }
}
