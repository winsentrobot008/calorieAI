"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  writeCredits,
  writeProFlag,
  clearUserDataCache,
} from "@/lib/local-store";

export interface AuthSessionState {
  user_id: string;
  email: string;
  name?: string;
  credits?: number;
  is_pro?: boolean;
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

function loadTurnstileScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();
    if ((window as any).turnstile) return resolve();
    if (document.getElementById("cf-turnstile-script")) {
      const check = () =>
        (window as any).turnstile ? resolve() : setTimeout(check, 100);
      check();
      return;
    }
    const s = document.createElement("script");
    s.id = "cf-turnstile-script";
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });
}

function AuthModal({
  onClose,
  addLog,
  onAuthChange,
  onLogout,
}: {
  onClose: () => void;
  addLog: (msg: string) => void;
  onAuthChange?: (session: AuthSessionState) => void;
  onLogout?: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [devCode, setDevCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const hasTurnstile = !!TURNSTILE_SITE_KEY;

  // 挂载 Turnstile（仅配置 site key 时；未配置 = 演示模式，后端自动放行）
  useEffect(() => {
    setHydrated(true);
    if (!hasTurnstile) return;
    let cancelled = false;
    (async () => {
      await loadTurnstileScript();
      if (cancelled || typeof window === "undefined" || !(window as any).turnstile) return;
      if (!turnstileRef.current) return;
      const w = (window as any).turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
      widgetIdRef.current = w;
    })();
    return () => {
      cancelled = true;
      if (widgetIdRef.current && (window as any).turnstile) {
        try {
          (window as any).turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
      }
    };
  }, [hasTurnstile]);

  // 发送验证码后 60s 冷却倒计时
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /** 重置 Turnstile 以获取新 token（send-code 消费后 register 再校验） */
  const resetTurnstile = () => {
    if (widgetIdRef.current && (window as any).turnstile) {
      try {
        (window as any).turnstile.reset(widgetIdRef.current);
      } catch {
        /* ignore */
      }
    }
    setTurnstileToken("");
  };

  const applySession = (session: AuthSessionState) => {
    // 切换账号前清空旧账号/演示模式的积分、Pro、支付流水残留
    clearUserDataCache();
    localStorage.setItem("user_id", session.user_id);
    localStorage.setItem("user_email", session.email);
    if (session.name) localStorage.setItem("user_name", session.name);
    if (typeof session.credits === "number") writeCredits(session.credits);
    writeProFlag(!!session.is_pro);
    onAuthChange?.(session);
  };

  const handleSocial = async (provider: "google" | "apple") => {
    setError("");
    setLoading(true);
    addLog(`[AUTH] 尝试 ${provider} 一键登录...`);
    try {
      const res = await fetch(`/api/v1/user/oauth/${provider}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || `${provider} 登录失败`);
      addLog(`[AUTH] ${provider} 登录成功: ${data.email || ""}`);
      applySession({
        user_id: data.user_id,
        email: data.email || "",
        name: data.name || provider,
        credits: data.credits,
        is_pro: data.is_pro,
      });
      onClose();
    } catch (err: any) {
      const msg = err?.message || "社交登录失败";
      setError(msg);
      addLog(`[AUTH] ${provider} 登录失败: ${msg}`);
    }
    setLoading(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, human_token: turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || "登录失败，请稍后重试");
      addLog(`[AUTH] 登录成功: ${data.email || email}（user_id=${data.user_id}）`);
      applySession({
        user_id: data.user_id,
        email: data.email || email,
        name: data.name,
        credits: data.credits,
        is_pro: data.is_pro,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "登录失败");
    }
    setLoading(false);
  };

  /** 注册第一步：发送 OTP 验证码（Turnstile 校验 + 严格限频） */
  const handleSendCode = async () => {
    if (loading || cooldown > 0) return;
    setLoading(true);
    setError("");
    setDevCode("");
    try {
      const res = await fetch("/api/v1/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, human_token: turnstileToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "验证码发送失败");
      if (data.dev_code) setDevCode(String(data.dev_code));
      setStep("otp");
      setCooldown(60);
      resetTurnstile(); // 新 token 供注册提交时再次校验
      addLog(`[AUTH] 验证码已发送至 ${email}${data.dev_code ? `（演示码 ${data.dev_code}）` : ""}`);
    } catch (err: any) {
      setError(err.message || "验证码发送失败");
      addLog(`[AUTH] 验证码发送失败: ${err.message || ""}`);
    }
    setLoading(false);
  };

  /** 注册第二步：验证 OTP → 绑定邮箱注册 */
  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      addLog("[AUTH] 正在校验邮箱验证码...");
      const verifyRes = await fetch("/api/v1/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otpCode }),
      });
      const verifyData = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) throw new Error(verifyData.error || "验证码错误");

      addLog("[AUTH] 邮箱已验证，正在创建账号...");
      const regRes = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          name,
          human_token: turnstileToken,
          email_verified_token: verifyData.email_verified_token,
        }),
      });
      const regData = await regRes.json().catch(() => ({}));
      if (!regRes.ok) throw new Error(regData.error || regData.detail || "注册失败");
      addLog(`[AUTH] 注册成功: ${regData.email || email}（user_id=${regData.user_id}）`);
      applySession({
        user_id: regData.user_id,
        email: regData.email || email,
        name: regData.name,
        credits: regData.credits,
        is_pro: regData.is_pro,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || "注册失败");
    }
    setLoading(false);
  };

  const handleAnonymous = () => {
    clearUserDataCache();
    const anonId = `anon_${Date.now()}`;
    localStorage.setItem("user_id", anonId);
    localStorage.removeItem("user_email");
    addLog("[AUTH] 游客模式继续");
    onAuthChange?.({ user_id: anonId, email: "" });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content login-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{mode === "login" ? t("login_title") : t("login_register")}</h2>
          <button className="modal-close" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <div className="login-error">{error}</div>}

        {/* 社交一键登录（移动端优先展示） */}
        <div className="auth-social-grid">
          <button
            type="button"
            className="btn-primary auth-social-btn"
            onClick={() => handleSocial("google")}
            disabled={loading}
          >
            <span className="auth-social-icon">G</span> {t("auth_social_google")}
          </button>
          <button
            type="button"
            className="btn-primary auth-social-btn auth-social-apple"
            onClick={() => handleSocial("apple")}
            disabled={loading}
          >
            <span className="auth-social-icon"> </span> {t("auth_social_apple")}
          </button>
        </div>
        <div className="auth-divider">
          <span>{t("auth_or_email")}</span>
        </div>

        {step === "form" && (
          <form
            onSubmit={mode === "login" ? handleLogin : (e) => e.preventDefault()}
            className="login-form"
          >
            {mode === "register" && (
              <div className="form-group">
                <label>{t("nickname")}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("nickname_placeholder")}
                  className="form-input"
                />
              </div>
            )}
            <div className="form-group">
              <label>{t("login_email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                className="form-input"
                autoComplete="email"
              />
            </div>
            <div className="form-group">
              <label>{t("login_password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={4}
                placeholder="••••••"
                className="form-input"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>

            {hasTurnstile && (
              <div className="form-group" style={{ display: "flex", justifyContent: "center" }}>
                <div ref={turnstileRef} className="cf-turnstile" />
              </div>
            )}

            {mode === "login" ? (
              <button type="submit" className="btn-primary login-submit" disabled={loading}>
                {loading ? t("admin_logging_in") : t("login_title")}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary login-submit"
                onClick={handleSendCode}
                disabled={loading || cooldown > 0}
              >
                {cooldown > 0 ? t("auth_resend_in", { s: cooldown }) : t("auth_send_code")}
              </button>
            )}
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleVerifyAndRegister} className="login-form">
            <p className="auth-otp-hint">{t("auth_otp_hint", { email })}</p>
            {devCode && (
              <p className="auth-dev-code">{t("auth_code_dev_hint", { code: devCode })}</p>
            )}
            <div className="form-group">
              <label>{t("auth_otp_label")}</label>
              <input
                type="text"
                inputMode="numeric"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                placeholder={t("auth_otp_placeholder")}
                className="form-input otp-input"
                autoFocus
              />
            </div>
            <button type="submit" className="btn-primary login-submit" disabled={loading}>
              {loading ? t("admin_logging_in") : t("auth_verify_register")}
            </button>
            <button
              type="button"
              className="btn-link"
              style={{ marginTop: 8 }}
              onClick={() => {
                setStep("form");
                setOtpCode("");
                setDevCode("");
              }}
            >
              {t("admin_back_home")} / {t("auth_resend_short")}
            </button>
          </form>
        )}

        <div className="login-toggle">
          <button
            className="btn-link"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setStep("form");
              setError("");
              setOtpCode("");
              setDevCode("");
              resetTurnstile();
            }}
          >
            {mode === "login" ? t("no_account_register") : t("have_account_login")}
          </button>
        </div>
        <div className="login-anonymous">
          <p>{t("login_anonymous_hint")}</p>
          <button className="btn-secondary login-anon-btn" onClick={handleAnonymous}>
            {t("login_continue_anon")}
          </button>
        </div>
        {hydrated && localStorage.getItem("user_email") && (
          <div className="login-logout">
            <button
              className="btn-link logout-btn"
              onClick={() => {
                localStorage.removeItem("user_id");
                localStorage.removeItem("user_email");
                localStorage.removeItem("user_name");
                clearUserDataCache();
                addLog("[AUTH] 已退出登录");
                onLogout?.();
                onClose();
              }}
            >
              {t("logout")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthModal;
