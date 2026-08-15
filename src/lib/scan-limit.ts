/**
 * scan-limit — Cal AI 免费扫描次数门控
 *
 * 对标 Cal AI 极简闭环：前 2 次拍照免费（AI 拆解 + 保存到今日进度），
 * 第 3 次拍照触发 Stripe 全英文 $9.99/月 Pro 订阅（Paywall）。
 */

const SCAN_KEY = "calorieai_scan_count";
export const FREE_SCAN_LIMIT = 2; // 免费次数：2（第 3 次触发订阅）

export function getScanCount(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(localStorage.getItem(SCAN_KEY) || "0");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function incrementScanCount(): number {
  const next = getScanCount() + 1;
  localStorage.setItem(SCAN_KEY, String(next));
  return next;
}

/** 登录新账号 / 退出时重置（新账号重新获得免费次数） */
export function resetScanCount(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SCAN_KEY);
}
