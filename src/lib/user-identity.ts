/**
 * user-identity — 服务端用户身份生成（稳定 user_id）
 *
 * 同一邮箱登录/注册始终得到同一个 user_id，积分与 Pro 状态按账号稳定落库，
 * 避免每次登录生成随机 id 导致数据"丢失"或跨端不一致。
 */
import crypto from "crypto";

export function stableUserId(email: string): string {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return `anon_${Date.now()}`;
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `user_${hash}`;
}
