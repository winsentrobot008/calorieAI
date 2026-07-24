/**
 * Simple i18n — lightweight translation helper without external deps.
 *
 * Usage:
 *   import { t, setLocale } from "@/lib/i18n"
 *   t("app_title")         // → "AI 卡路里助手"
 *   t("remaining_times", { count: 3 })  // → "剩余 3 次"
 */

import zh from "./zh.json";
import en from "./en.json";

const locales: Record<string, Record<string, string>> = { zh, en };

function getBrowserLocale(): string {
  if (typeof navigator === "undefined") return "zh";
  const lang = navigator.language || "zh";
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("sv")) return "zh"; // fallback
  return "en";
}

let currentLocale = getBrowserLocale();

export function setLocale(locale: string) {
  if (locales[locale]) currentLocale = locale;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const locale = locales[currentLocale] || locales.zh;
  let text = locale[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
