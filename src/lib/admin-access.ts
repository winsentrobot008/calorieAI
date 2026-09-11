/**
 * admin-access — 服务端管理员识别（测试期每日频控豁免判定）
 *
 * 任一命中即为管理员（跳过每日限额，允许无限次调用）：
 *   1. 请求携带的 x-admin-token（或 Authorization: Bearer）命中后台会话，
 *      且会话角色为 admin / superadmin；
 *   2. 该令牌命中 ADMIN_API_TOKENS / ADMIN_API_TOKEN / ADMIN_TOKEN 配置的静态令牌；
 *   3. 请求解析出的 user_id 等于任一管理员邮箱派生的稳定 user_id
 *      （登录/注册统一走 stableUserId(email)，管理员本人登录即命中）。
 *
 * 安全约定：只信任服务端可验证凭据（会话令牌 / 静态令牌 / 服务端派生 ID），
 * 不信任客户端直接传入的 email、role 等可伪造字段。
 */

import type { NextRequest } from "next/server";
import { ADMIN_EMAILS, isAdminRole } from "@/lib/admin-identity";
import { getAdminSession } from "@/lib/admin-session";
import { stableUserId } from "@/lib/user-identity";

/** 管理员邮箱派生的稳定 user_id 集合 */
const ADMIN_USER_IDS: string[] = ADMIN_EMAILS.map((email) => stableUserId(email));

/** user_id 是否为管理员账号（登录态经服务端派生的稳定 ID） */
export function isAdminUserId(userId?: string | null): boolean {
  const id = (userId || "").trim();
  return Boolean(id) && ADMIN_USER_IDS.includes(id);
}

/** 环境变量配置的静态管理员令牌（支持逗号分隔多个） */
export function adminStaticTokens(): string[] {
  return [process.env.ADMIN_API_TOKENS, process.env.ADMIN_API_TOKEN, process.env.ADMIN_TOKEN]
    .flatMap((value) => (value || "").split(","))
    .map((token) => token.trim())
    .filter(Boolean);
}

/** 令牌是否为有效管理员令牌（静态令牌 或 后台会话角色 admin/superadmin） */
export function isAdminToken(token?: string | null): boolean {
  const value = (token || "").trim();
  if (!value) return false;
  if (adminStaticTokens().includes(value)) return true;
  const session = getAdminSession(value);
  if (!session) return false;
  return isAdminRole(session.role);
}

/** 从请求头提取管理员令牌（x-admin-token 优先，其次 Authorization: Bearer） */
export function adminTokenFromRequest(request: NextRequest): string {
  const raw = request.headers.get("x-admin-token") || request.headers.get("authorization") || "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();
}

/** 路由入口统一判定：管理员 user_id 或有效管理员令牌 */
export function isAdminRequest(request: NextRequest, userId?: string | null): boolean {
  return isAdminUserId(userId) || isAdminToken(adminTokenFromRequest(request));
}
