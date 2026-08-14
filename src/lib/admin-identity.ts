/**
 * admin-identity — 前端管理员身份判定统一入口
 *
 * 判定规则（任一命中即为 isAdmin = true）：
 *   1. 当前登录邮箱命中内置特权账号（winsentrobot / winsentrobot008 系）：
 *        - winsentrobot@gmail.com
 *        - winsentrobot008@gmail.com
 *   2. 当前登录邮箱命中环境变量指定账号（支持逗号分隔多个）：
 *        - NEXT_PUBLIC_ADMIN_USER_ID
 *        - NEXT_PUBLIC_ADMIN_EMAIL
 *        - ADMIN_EMAIL
 *        - ADMIN_USER_ID
 *   3. 管理后台会话角色为 admin / superadmin。
 *
 * 注意：客户端 bundle 只会内联 NEXT_PUBLIC_* 环境变量，服务端可额外读取
 * ADMIN_EMAIL / ADMIN_USER_ID（此处统一纳入，两端共用同一模块）。
 */

const BUILTIN_ADMIN_EMAILS = ["winsentrobot@gmail.com", "winsentrobot008@gmail.com"];

function parseEmails(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 全部管理员邮箱（内置 + 环境变量，去重、小写归一）。 */
export const ADMIN_EMAILS: string[] = [
  ...BUILTIN_ADMIN_EMAILS,
  ...parseEmails(process.env.NEXT_PUBLIC_ADMIN_USER_ID),
  ...parseEmails(process.env.NEXT_PUBLIC_ADMIN_EMAIL),
  ...parseEmails(process.env.ADMIN_EMAIL),
  ...parseEmails(process.env.ADMIN_USER_ID),
].filter((v, i, arr) => arr.indexOf(v) === i);

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  return ADMIN_EMAILS.includes(normalized);
}

export function isAdminRole(role?: string | null): boolean {
  return role === "admin" || role === "superadmin";
}

export interface AdminIdentityInput {
  email?: string | null;
  role?: string | null;
}

/** 统一判定：管理员邮箱命中 或 会话角色为 admin/superadmin。 */
export function isAdminIdentity(input: AdminIdentityInput): boolean {
  return isAdminEmail(input.email) || isAdminRole(input.role);
}
