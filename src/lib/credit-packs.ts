/**
 * credit-packs — CalorieAI 商品目录适配层（商业引擎统一实现）
 *
 * 权威价格 / 积分目录已迁移至 commercial-engine/middleware/credit-packs.ts，
 * 本文件仅作 re-export，保证既有 import 路径不变。
 */

export {
  CREDIT_PACKS,
  DEFAULT_PACK_ID,
  getCreditPack,
  resolvePack,
  type CreditPack,
} from "@git008/commercial-engine/middleware/credit-packs";
