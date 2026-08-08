import type { DbAdapter } from "../types";
import * as billing from "@/lib/billing-store";
import * as vision from "@/lib/vision-log-store";
import * as analytics from "@/lib/analytics-store";
import * as credits from "@/lib/credits-store";

/**
 * 文件适配器：无 Postgres/KV 配置时的本地回退实现。
 * 数据写入 os.tmpdir() 临时目录（兼容 Vercel serverless 只读文件系统）。
 * 注意：文件/临时目录为进程级存储，跨实例一致性需配置 Postgres 或 KV。
 */
export const fileAdapter: DbAdapter = {
  kind: "file",

  getCredits: async (userId) => credits.getCredits(userId),
  setCredits: async (userId, value) => {
    credits.setCredits(userId, value);
  },

  getSubscription: async (userId) => billing.getSubscription(userId),
  getSubscriptionByEmail: async (email) => billing.getSubscriptionByEmail(email),
  getSubscriptionByStripeCustomerId: async (customerId) => billing.getSubscriptionByStripeCustomerId(customerId),
  getSubscriptionByStripeSubscriptionId: async (subscriptionId) =>
    billing.getSubscriptionByStripeSubscriptionId(subscriptionId),
  upsertSubscription: async (userId, data) => billing.upsertSubscription(userId, data),
  deactivateSubscription: async (userId) => billing.deactivateSubscription(userId),
  getAllSubscriptions: async () => billing.getAllSubscriptions(),

  recordPayment: async (input) => billing.recordPayment(input),
  getPayments: async () => billing.getAllPayments(),

  recordVisionLog: async (entry) => {
    vision.recordVisionLog(entry);
  },
  getVisionLogs: async (limit) => vision.getVisionLogs(limit),
  getAllVisionLogs: async () => vision.getAllVisionLogs(),

  recordVisit: async (entry) => {
    analytics.recordVisit(entry);
  },
  getVisits: async () => analytics.getAllVisits(),
};
