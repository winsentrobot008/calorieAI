import { NextRequest, NextResponse } from "next/server";
import { createAdminSession } from "@/lib/admin-session";

/**
 * 特权管理员账号（准上线配置）:
 *   - winsentrobot@gmail.com / 0833  → CEO 特权管理员
 *   - admin / admin123               → 兼容保留账号
 */
const ADMIN_ACCOUNTS = [
  {
    username: "winsentrobot@gmail.com",
    password: "0833",
    admin_id: "admin_ceo",
    role: "superadmin",
    display_name: "CEO",
  },
  {
    username: "admin",
    password: "admin123",
    admin_id: "admin_001",
    role: "superadmin",
    display_name: "admin",
  },
];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = (body.username || new URL(request.url).searchParams.get("username") || "").toString();
  const password = (body.password || new URL(request.url).searchParams.get("password") || "").toString();

  const account = ADMIN_ACCOUNTS.find((a) => a.username === username && a.password === password);
  if (account) {
    // 签发服务端会话令牌：后续 /api/v1/admin/* 请求必须携带 x-admin-token
    const session = createAdminSession({
      admin_id: account.admin_id,
      username: account.username,
      role: account.role,
      display_name: account.display_name,
    });
    return NextResponse.json({
      admin_id: session.admin_id,
      username: session.username,
      role: session.role,
      display_name: session.display_name,
      token: session.token,
    });
  }
  return NextResponse.json({ detail: "用户名或密码错误" }, { status: 401 });
}
