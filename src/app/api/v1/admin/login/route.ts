import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get("username");
  const password = searchParams.get("password");

  if (username === "admin" && password === "admin123") {
    return NextResponse.json({
      admin_id: "admin_001",
      username: "admin",
      role: "superadmin",
    });
  }
  return NextResponse.json({ detail: "用户名或密码错误" }, { status: 401 });
}
