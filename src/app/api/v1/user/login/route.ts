import { NextRequest, NextResponse } from "next/server";
import { stableUserId } from "@/lib/user-identity";
import { db, initCreditsIfMissing } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { searchParams } = new URL(request.url);
  const email = (body.email || searchParams.get("email") || "").toString();
  const password = (body.password || searchParams.get("password") || "").toString();

  if (!email || !password) {
    return NextResponse.json({ detail: "请提供邮箱和密码" }, { status: 400 });
  }

  // 同一邮箱始终映射到同一 user_id（积分/Pro 按账号稳定落库）
  const userId = stableUserId(email);
  // 登录即同步服务端权威积分与 Pro 状态（新用户自动初始化默认赠送积分）
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
