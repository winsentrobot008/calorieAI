/**
 * stripe-i18n — CalorieAI 支付 i18n 适配层（商业引擎统一实现）
 *
 * 权威实现已迁移至 commercial-engine/middleware/stripe-i18n.ts
 * （统一商品名 / 描述 + CJK 零汉字断言），本文件仅作 re-export。
 */

export {
  CJK_CHARS_REGEX,
  getLocalizedPaymentItem,
  hasChineseChars,
  isZhLang,
  type LocalizedPaymentItem,
  type StripePlanId,
} from "@commercial-engine/middleware/stripe-i18n";
