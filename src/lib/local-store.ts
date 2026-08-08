/**
 * local-store — 客户端本地积分与支付流水存储（localStorage）
 *
 * 积分规则（准上线）:
 *   - 新用户初始化赠送 3 积分；
 *   - AI 识图每次固定扣 1 积分；
 *   - 看 1 次激励广告 +10 积分；
 *   - 购买 $1.00 方案 +10 积分（同时升级 Pro 无限积分）。
 */

export const CREDIT_KEY = "user_credits";
export const PAYMENTS_KEY = "user_payments";
export const DEFAULT_CREDITS = 3;
export const AD_REWARD_CREDITS = 10;
export const AD_COUNTDOWN_SECONDS = 4;
export const PAYMENT_CREDIT_BONUS = 10;

/** 读取积分余额：新用户首次访问自动赠送 3 积分 */
export function readCredits(): number {
  if (typeof window === "undefined") return DEFAULT_CREDITS;
  const raw = localStorage.getItem(CREDIT_KEY);
  if (raw === null) {
    localStorage.setItem(CREDIT_KEY, String(DEFAULT_CREDITS));
    return DEFAULT_CREDITS;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_CREDITS;
}

/** 写入积分余额（不低于 0） */
export function writeCredits(value: number): void {
  localStorage.setItem(CREDIT_KEY, String(Math.max(0, Math.floor(value))));
}

/** 增加积分并返回新余额 */
export function addCredits(delta: number): number {
  const next = Math.max(0, readCredits() + delta);
  writeCredits(next);
  return next;
}

export interface LocalPayment {
  orderId: string;
  provider: "stripe" | "paypal";
  plan: string;
  amount: number;
  ts: string;
}

/** 读取本机支付流水（供管理员后台合并展示，保证 $1.00 收入增量 100% 可见） */
export function readLocalPayments(): LocalPayment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PAYMENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 记录一笔支付流水（按 orderId 去重，上限 50 条） */
export function recordLocalPayment(payment: Omit<LocalPayment, "ts">): LocalPayment[] {
  const arr = readLocalPayments();
  if (arr.some((p) => p.orderId === payment.orderId)) return arr;
  arr.push({ ...payment, ts: new Date().toISOString() });
  const next = arr.slice(-50);
  localStorage.setItem(PAYMENTS_KEY, JSON.stringify(next));
  return next;
}

/** 本机支付流水统计：总额 / 笔数 */
export function localPaymentStats(): { total: number; count: number } {
  return readLocalPayments().reduce(
    (acc, p) => ({
      total: acc.total + (Number(p.amount) || 0),
      count: acc.count + 1,
    }),
    { total: 0, count: 0 }
  );
}
