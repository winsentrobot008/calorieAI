import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  const password = searchParams.get("password");
  const name = searchParams.get("name") || email?.split("@")[0] || "User";

  if (!email || !password) {
    return NextResponse.json({ detail: "请提供邮箱和密码" }, { status: 400 });
  }

  const userId = `user_${Date.now()}`;
  return NextResponse.json({ user_id: userId, email, name });
}
