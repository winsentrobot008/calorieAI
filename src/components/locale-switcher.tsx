"use client";

import { useLocale, setLocale, type Locale } from "@/lib/i18n";
import { Languages } from "lucide-react";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "en", label: "EN" },
];

/**
 * Manual language switcher. Persists the choice to localStorage via setLocale(),
 * which takes priority over the auto-detected system language (navigator.language).
 */
export default function LocaleSwitcher() {
  const locale = useLocale();

  return (
    <div
      className="locale-switcher"
      style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
      aria-label="Language switcher"
    >
      <Languages className="h-4 w-4 text-zinc-400" />
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setLocale(opt.value)}
          aria-pressed={locale === opt.value}
          className={`locale-btn ${locale === opt.value ? "active" : ""}`}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 11,
            lineHeight: 1,
            fontWeight: locale === opt.value ? 700 : 400,
            color: locale === opt.value ? "#fbbf24" : "#94a3b8",
            padding: "4px 6px",
            borderRadius: 6,
            transition: "color .2s",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
