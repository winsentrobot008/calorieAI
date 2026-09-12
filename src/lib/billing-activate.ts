/**
 * billing-activate — CalorieAI 订阅激活适配层（商业引擎统一实现）
 *
 * 权威周期计算已迁移至 commercial-engine/middleware/billing-activate.ts，
 * 本文件以 db 适配器接线并保留原导出签名。
 */

import {
  activateSubscription as sharedActivate,
  type ActivateSubscriptionOptions,
  type SubscriptionStorePort,
} from "@git008/commercial-engine/middleware/billing-activate";
import type { SubscriptionRecord } from "@/lib/billing-store";
import { db } from "@/lib/db";

const store: SubscriptionStorePort = {
  upsertSubscription: (userId, data) => db.upsertSubscription(userId, data),
};

export type { ActivateSubscriptionOptions };

export async function activateSubscription(
  options: ActivateSubscriptionOptions
): Promise<SubscriptionRecord> {
  return sharedActivate(options, store);
}
