/**
 * admin-auth — /api/v1/admin/* 服务端鉴权拦截
 *
 * 所有管理后台数据路由（除 login）必须通过 getAdminAuth 校验：
 *   1. 读取 x-admin-token（或 Authorization: Bearer）;
 *   2. 命中静态管理员密钥（ADMIN_API_TOKEN 等）或登录时签发的服务端会话令牌；
 *   3. 无效/缺失 → 401，绝不返回任何业务数据。
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, type AdminSession } from "./admin-session";
import { adminStaticTokens, adminTokenFromRequest } from "./admin-access";

export type AdminAuthResult =
  | { ok: true; session: AdminSession }
  | { ok: false; response: NextResponse };

export function getAdminAuth(request: NextRequest): AdminAuthResult {
  const token = adminTokenFromRequest(request);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "UNAUTHORIZED", detail: "缺少管理员令牌" },
        { status: 401 }
      ),
    };
  }
  // 静态管理员密钥：无状态、可跨 Serverless 实例复用。
  // 前端 401 弹窗录入的 ADMIN_API_TOKEN 即走此分支完成鉴权。
  if (adminStaticTokens().includes(token)) {
    return {
      ok: true,
      session: {
        token,
        admin_id: "admin_static_token",
        username: "admin",
        role: "superadmin",
        display_name: "Admin (static token)",
        created_at: new Date().toISOString(),
      },
    };
  }
  const session = getAdminSession(token);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "UNAUTHORIZED", detail: "管理员令牌无效或已过期" },
        { status: 401 }
      ),
    };
  }
  return { ok: true, session };
}
