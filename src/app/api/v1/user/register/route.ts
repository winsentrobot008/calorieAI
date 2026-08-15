import { NextRequest, NextResponse } from "next/server";
import { stableUserId } from "@/lib/user-identity";
import { db, initCreditsIfMissing } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { searchParams } = new URL(request.url);
  const email = (body.email || searchParams.get("email") || "").toString();
  const password = (body.password || searchParams.get("password") || "").toString();
  const name =
    (body.name || searchParams.get("name") || email.split("@")[0] || "User").toString();

  if (!email || !password) {
    return NextResponse.json({ detail: "请提供邮箱和密码" }, { status: 400 });
  }

  // 同一邮箱注册/登录使用同一 user_id，积分与 Pro 状态按账号持久化
  const userId = stableUserId(email);
  const credits = await initCreditsIfMissing(userId);
  const sub = await db.getSubscription(userId);
  return NextResponse.json({
    user_id: userId,
    email,
    name,
    credits,
    is_pro: !!sub?.is_active,
  });
}
