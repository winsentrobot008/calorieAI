/**
 * credit-packs — CalorieAI 商品目录适配层（商业引擎统一实现）
 *
 * 权威价格 / 积分目录已迁移至 commercial-engine/middleware/credit-packs.ts，
 * 本文件仅作 re-export，保证既有 import 路径不变。
 */

export {
  CNY_PER_CREDIT,
  CNY_PER_USD,
  CREDIT_PACKS,
  DEFAULT_PACK_ID,
  cnyToUsd,
  getCreditPack,
  resolvePack,
  type CreditPack,
} from "@git008/commercial-engine/middleware/credit-packs";
