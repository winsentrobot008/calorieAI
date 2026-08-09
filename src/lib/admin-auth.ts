/**
 * admin-auth — /api/v1/admin/* 服务端鉴权拦截
 *
 * 所有管理后台数据路由（除 login）必须通过 getAdminAuth 校验：
 *   1. 读取 x-admin-token（或 Authorization: Bearer）;
 *   2. 与登录时签发的服务端会话令牌比对；
 *   3. 无效/缺失 → 401，绝不返回任何业务数据。
 */

import { NextRequest, NextResponse } from "next/server";
import { getAdminSession, type AdminSession } from "./admin-session";

export type AdminAuthResult =
  | { ok: true; session: AdminSession }
  | { ok: false; response: NextResponse };

export function getAdminAuth(request: NextRequest): AdminAuthResult {
  const rawHeader =
    request.headers.get("x-admin-token") ||
    request.headers.get("authorization") ||
    "";
  const token = rawHeader.startsWith("Bearer ")
    ? rawHeader.slice(7).trim()
    : rawHeader.trim();
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "UNAUTHORIZED", detail: "缺少管理员令牌" },
        { status: 401 }
      ),
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
