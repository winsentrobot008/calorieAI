"use client";

import Link from "next/link";
import { Sun, Moon } from "lucide-react";
import { t } from "@/lib/i18n";
import LocaleSwitcher from "@/components/locale-switcher";
import { useTheme } from "@/components/theme-provider";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="rounded-full p-2 transition-colors hover:bg-zinc-700/50"
      aria-label={t("toggle_theme")}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4 text-yellow-400" />
      ) : (
        <Moon className="h-4 w-4 text-zinc-400" />
      )}
    </button>
  );
}

interface HeaderProps {
  isAdmin: boolean;
  isLoggedIn: boolean;
  isPro: boolean;
  userLabel: string;
  onLoginClick: () => void;
  onBillingClick: () => void;
  onLogoDoubleClick?: () => void;
}

/**
 * 顶部导航栏：当 isAdmin 为 true 时显式渲染【⚙️ 控制面板 / Admin Dashboard】入口，
 * 点击跳转至 /admin。
 */
export default function Header({
  isAdmin,
  isLoggedIn,
  isPro,
  userLabel,
  onLoginClick,
  onBillingClick,
  onLogoDoubleClick,
}: HeaderProps) {
  return (
    <header className="header">
      <div className="header-left">
        <span
          className="logo"
          onDoubleClick={onLogoDoubleClick}
          style={{ cursor: onLogoDoubleClick ? "pointer" : "default" }}
        >
          CalorieAI
        </span>
        <span className="goal-badge">{t("goal_maintain_short")}</span>
      </div>
      <div className="header-right">
        <span className="daily-target">
          {t("daily_target_label", { calories: 2000 })}
        </span>
        <button
          className={`btn-upgrade ${isPro ? "btn-upgrade-active" : ""}`}
          onClick={onBillingClick}
        >
          {isPro ? t("pro_active_badge") : isLoggedIn ? t("pro_badge") : t("upgrade_badge")}
        </button>
        {isAdmin && (
          <Link href="/admin" className="btn-admin" aria-label={t("admin_dashboard_btn")}>
            ⚙️ {t("admin_dashboard_btn")}
          </Link>
        )}
        <button className="btn-login" onClick={onLoginClick}>
          {userLabel}
        </button>
        <LocaleSwitcher />
        <ThemeToggle />
      </div>
    </header>
  );
}
