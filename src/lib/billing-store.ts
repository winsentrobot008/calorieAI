/**
 * billing-store — CalorieAI 账单存储适配层（商业引擎统一实现）
 *
 * 权威订阅 / 支付流水逻辑已迁移至 commercial-engine/middleware/billing-store.ts
 * （幂等入账 recordPayment / 收入统计 / 文件持久化回退），本文件仅作 re-export，
 * 保证 db 适配器与既有 import 路径不变。
 */

export {
  deactivateSubscription,
  getActiveSubscriptionCount,
  getAllPayments,
  getAllSubscriptions,
  getPaymentStats,
  getPermanentLicenseCount,
  getSubscription,
  getSubscriptionByEmail,
  getSubscriptionByStripeCustomerId,
  getSubscriptionByStripeSubscriptionId,
  recordPayment,
  upsertSubscription,
  type PaymentRecord,
  type SubscriptionRecord,
} from "@commercial-engine/middleware/billing-store";
