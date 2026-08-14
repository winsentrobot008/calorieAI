"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, useLocale } from "@/lib/i18n";
import {
  AdminLoginPanel,
  AdminDashboardPanel,
} from "@/components/admin/admin-panel";
import { isAdminEmail } from "@/lib/admin-identity";

const ADMIN_SESSION_KEY = "admin_session";

type AdminPageState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "login" }
  | { status: "ready"; session: any };

/**
 * /admin 管理后台路由：
 *   - 已有管理员会话 → 直接进入控制面板；
 *   - 当前登录邮箱命中管理员身份（winsentrobot / winsentrobot008 / ADMIN 环境变量）
 *     → 展示管理员登录页；
 *   - 未登录或非管理员 → 优雅提示后重定向至首页。
 */
export default function AdminPage() {
  useLocale();
  const router = useRouter();
  const [state, setState] = useState<AdminPageState>({ status: "loading" });

  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (saved) {
      try {
        const session = JSON.parse(saved);
        if (session?.token) {
          setState({ status: "ready", session });
          return;
        }
      } catch {
        /* 会话损坏 → 按未登录处理 */
      }
    }

    const userId = localStorage.getItem("user_id") || "";
    const email = localStorage.getItem("user_email") || "";
    if (!userId && !email) {
      // 完全未登录 → 重定向首页
      setState({ status: "denied" });
      return;
    }
    if (isAdminEmail(email)) {
      // 管理员邮箱命中 → 可在此输入管理员口令
      setState({ status: "login" });
      return;
    }
    // 非管理员 → 重定向首页
    setState({ status: "denied" });
  }, []);

  // 非管理员 / 未登录：优雅提示后重定向至首页
  useEffect(() => {
    if (state.status === "denied") {
      const timer = setTimeout(() => router.replace("/"), 1200);
      return () => clearTimeout(timer);
    }
  }, [state.status, router]);

  const handleLogin = (session: any) => {
    sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
    setState({ status: "ready", session });
  };

  const handleLogout = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    router.replace("/");
  };

  return (
    <div className="app">
      <div className="admin-page-top">
        <Link href="/" className="admin-back-btn">
          ← {t("admin_back_home")}
        </Link>
        {state.status === "ready" && (
          <span className="admin-user">
            {state.session.displayName || state.session.username} ({state.session.role})
          </span>
        )}
      </div>

      {state.status === "loading" && (
        <div className="admin-page-hint">{t("admin_loading")}</div>
      )}

      {state.status === "denied" && (
        <div className="admin-page-hint">{t("admin_access_denied")}</div>
      )}

      {state.status === "login" && (
        <>
          <AdminLoginPanel onLogin={handleLogin} />
          <div className="admin-page-hint" style={{ marginTop: 12 }}>
            <Link href="/" className="admin-back-btn">
              {t("admin_back_home")}
            </Link>
          </div>
        </>
      )}

      {state.status === "ready" && (
        <AdminDashboardPanel session={state.session} onLogout={handleLogout} />
      )}
    </div>
  );
}
