import type { SubscriptionRecord, PaymentRecord } from "@/lib/billing-store";
import type { VisionLogEntry } from "@/lib/vision-log-store";
import type { VisitRecord } from "@/lib/analytics-store";

export interface RecordPaymentInput {
  orderId: string;
  provider: "stripe" | "paypal";
  plan: string; // Credits Top-up 积分包 id（旧订阅方案名保留兼容）
  amount: number;
  currency?: string;
  email?: string;
}

/**
 * 统一数据库访问层 (Database Access Layer) 契约。
 * 所有适配器（Postgres / KV / 文件）必须实现同一组方法，
 * 上层业务（订阅、支付、积分、识图日志、访问量）只依赖本接口。
 */
export interface DbAdapter {
  kind: "file" | "kv" | "postgres";

  // ── 用户积分 (Credits) ──
  getCredits(userId: string): Promise<number | null>;
  setCredits(userId: string, credits: number): Promise<void>;

  // ── Pro 订阅记录 (Subscriptions) ──
  getSubscription(userId: string): Promise<SubscriptionRecord | null>;
  getSubscriptionByEmail(email: string): Promise<SubscriptionRecord | null>;
  getSubscriptionByStripeCustomerId(customerId: string): Promise<SubscriptionRecord | null>;
  getSubscriptionByStripeSubscriptionId(subscriptionId: string): Promise<SubscriptionRecord | null>;
  upsertSubscription(userId: string, data: Partial<SubscriptionRecord>): Promise<SubscriptionRecord>;
  deactivateSubscription(userId: string): Promise<SubscriptionRecord | null>;
  getAllSubscriptions(): Promise<SubscriptionRecord[]>;

  // ── 支付流水 (Payments) ──
  recordPayment(input: RecordPaymentInput): Promise<PaymentRecord | null>;
  getPayments(): Promise<PaymentRecord[]>;

  // ── 管理员运行日志 (Vision Logs) ──
  recordVisionLog(entry: Omit<VisionLogEntry, "ts">): Promise<void>;
  getVisionLogs(limit?: number): Promise<VisionLogEntry[]>;
  getAllVisionLogs(): Promise<VisionLogEntry[]>;

  // ── 流量 / IP 访问量 ──
  recordVisit(entry: Omit<VisitRecord, "ts">): Promise<void>;
  getVisits(): Promise<VisitRecord[]>;
}

export interface PaymentStats {
  total_revenue: number;
  count: number;
  subscription_revenue: number;
  license_revenue: number;
  plan_breakdown: Record<string, number>;
  recent_payments: PaymentRecord[];
}

export interface VisionStats {
  total_calls: number;
  today_calls: number;
  errors: number;
  error_rate_pct: number;
  by_provider: { name: string; model?: string; calls: number; errors: number; avg_latency_ms: number }[];
}

export interface VisitStats {
  total_visits: number;
  today_visits: number;
  unique_ips: number;
  recent_ips: { ip: string; count: number; last_seen: string }[];
  recent_visits: VisitRecord[];
}
