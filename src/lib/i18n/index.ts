/**
 * Lightweight i18n — zero-dependency translation helper.
 *
 * Locale resolution priority (see resolveLocale):
 *   1. localStorage manual override  (LOCALE_STORAGE_KEY)
 *   2. navigator.language (mobile/system language auto-detect)
 *   3. default "en" (unsupported system languages fall back to English)
 *
 * System language matching:
 *   zh-CN / zh-TW / zh-HK / zh-Hant ... → "zh"
 *   en-US / en-GB / en-AU ...           → "en"
 *   anything else                       → "en" (default fallback)
 *
 * Usage:
 *   import { t, setLocale, useLocale, useT } from "@/lib/i18n"
 *   t("app_title")                        // → "AI 卡路里助手" / "AI Calorie Assistant"
 *   t("remaining_times", { count: 3 })    // → "剩余 3 次" / "3 remaining"
 *   const locale = useLocale();           // reactive current locale
 *   const t = useT();                     // reactive t() (re-renders on change)
 */

"use client";

import { useSyncExternalStore } from "react";
import zh from "./zh.json";
import en from "./en.json";

export const SUPPORTED_LOCALES = ["zh", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "calorieai_locale";

const dictionaries: Record<Locale, Record<string, string>> = { zh, en };

/** Match navigator.language → supported locale; unknown → default "en". */
function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    /* ignore storage errors (private mode / disabled cookies) */
  }
  return null;
}

/**
 * Priority: manual override (localStorage) > system language (navigator) > default (en).
 */
function resolveLocale(): Locale {
  return readStoredLocale() ?? detectBrowserLocale();
}

let currentLocale: Locale = resolveLocale();

const listeners = new Set<() => void>();

function applyDocumentLang(locale: Locale) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }
}

function emitChange() {
  listeners.forEach((cb) => cb());
}

// Keep <html lang="..."> in sync with the resolved locale on the client.
if (typeof window !== "undefined") {
  applyDocumentLang(currentLocale);
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Manually switch the language and persist the preference to localStorage. */
export function setLocale(locale: Locale) {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) return;
  currentLocale = locale;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore storage errors */
  }
  applyDocumentLang(locale);
  emitChange();
}

/** Remove the manual override and fall back to the system language. */
export function resetLocale() {
  try {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  } catch {
    /* ignore storage errors */
  }
  currentLocale = detectBrowserLocale();
  applyDocumentLang(currentLocale);
  emitChange();
}

/**
 * Translate a key into the current locale.
 * Falls back to the default locale ("en") if a key is missing in the current one.
 * Supports "{param}" interpolation, e.g. t("remaining_times", { count: 3 }).
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale] ?? dictionaries[DEFAULT_LOCALE];
  let text = dict[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

/** Reactive hook — re-renders the component whenever the locale changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    getLocale,
    getLocale
  );
}

/** Reactive translator — re-renders the component with new translations. */
export function useT(): typeof t {
  useLocale();
  return t;
}
