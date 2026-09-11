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

/** 服务端签发的稳定 user_id 形状：user_<16 位 sha256 十六进制> */
const SERVER_USER_ID_PATTERN = /^user_[0-9a-f]{16}$/;

/** 客户端传入的 user_id 是否具备服务端签发形状（用于拒绝任意字符串） */
export function isServerIssuedUserId(raw: unknown): boolean {
  return typeof raw === "string" && SERVER_USER_ID_PATTERN.test(raw.trim());
}

/**
 * 匿名调用方身份：按 IP 派生稳定 ID（anon_<16 位哈希>）。
 *
 * 未通过服务端校验的请求统一落到该账号，使轮换任意 user_id 无法各自触发
 * initCreditsIfMissing 赠送额度；同时避免所有匿名用户共享 "anonymous"
 * 单一积分桶导致免费额度被全局耗尽。
 */
export function anonymousUserId(ip: string): string {
  const normalized = (ip || "").trim() || "unknown";
  const hash = crypto.createHash("sha256").update(`anon:${normalized}`).digest("hex").slice(0, 16);
  return `anon_${hash}`;
}
