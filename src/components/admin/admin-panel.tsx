"use client";

import { useState, useCallback, useEffect } from "react";
import { t } from "@/lib/i18n";
import { readLocalPayments, localPaymentStats } from "@/lib/local-store";

// ─── Admin Login ───────────────────────────────────────────────────────
export function AdminLoginPanel({ onLogin }: { onLogin: (s: any) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "用户名或密码错误");
      onLogin({
        adminId: data.admin_id,
        username: data.username,
        role: data.role,
        displayName: data.display_name,
        token: data.token,
      });
    } catch (err: any) {
      setError(err.message || "用户名或密码错误");
    }
    setLoading(false);
  };
  return (
    <div className="admin-login-wrapper">
      <div className="admin-login-card">
        <h2>{t("admin_title")}</h2>
        <p className="admin-login-hint">{t("admin_default_hint")}</p>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">{t("admin_username")}</label>
            <input
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="winsentrobot@gmail.com"
              autoComplete="username"
            />
          </div>
          <div className="form-group">
            <label className="form-label">{t("admin_password")}</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="0833"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="admin-login-error">{error}</p>}
          <button className="submit-btn" type="submit" disabled={loading}>
            {loading ? t("admin_logging_in") : t("login_title")}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Admin Dashboard ───────────────────────────────────────────────────
export function AdminDashboardPanel({
  session,
  onLogout,
}: {
  session: any;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState<any>({
    overview: null,
    revenue: null,
    traffic: null,
    logs: [],
    users: [],
    models: null,
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const headers = { "x-admin-token": session?.token || "" };
    setRefreshing(true);
    try {
      const [overview, revenue, traffic, logsRes, usersRes, models] =
        await Promise.all([
          fetch("/api/v1/admin/overview", { headers }).then((r) => r.json()),
          fetch("/api/v1/admin/revenue", { headers }).then((r) => r.json()),
          fetch("/api/v1/admin/traffic", { headers }).then((r) => r.json()),
          fetch("/api/v1/admin/logs", { headers }).then((r) => r.json()),
          fetch("/api/v1/admin/users", { headers }).then((r) => r.json()),
          fetch("/api/v1/admin/model-monitor", { headers }).then((r) => r.json()),
        ]);
      setData({
        overview,
        revenue,
        traffic,
        logs: logsRes.logs || [],
        users: usersRes.users || [],
        models,
      });
    } catch (err) {
      console.error("[Admin] 数据加载失败:", err);
    }
    setRefreshing(false);
  }, [session?.token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  const o = data.overview?.overview || {};
  const rev = data.revenue || {};
  const tr = data.traffic || {};
  const fmt = (ts?: string) => (ts ? ts.slice(0, 19).replace("T", " ") : "-");
  // 合并本机支付流水（localStorage），保证支付成功后后台 100% 看到增量
  const localPay = localPaymentStats();
  const localPayments = readLocalPayments();
  const mergedRevenue = Number(rev.total_revenue || 0) + localPay.total;
  const mergedSubs = (o.active_subscriptions || 0) + localPay.count;
  const mergedInvoices = (rev.invoice_count || 0) + localPay.count;
  const allPayments = [
    ...localPayments.map((lp) => ({
      created_at: lp.ts,
      order_id: lp.orderId,
      provider: lp.provider,
      plan: lp.plan,
      amount: lp.amount,
    })),
    ...(rev.recent_payments || []),
  ];

  function TabContent() {
    if (tab === "overview")
      return (
        <div className="admin-overview-grid">
          <div className="admin-stat-card" style={{ borderLeft: "3px solid #f59e0b" }}>
            <div className="admin-stat-label">{t("admin_total_revenue")}</div>
            <div className="admin-stat-value">${mergedRevenue.toFixed(2)}</div>
            <div className="admin-stat-sub">
              {t("admin_invoices")}: {mergedInvoices}
            </div>
          </div>
          <div className="admin-stat-card" style={{ borderLeft: "3px solid #34d399" }}>
            <div className="admin-stat-label">{t("admin_active_subscriptions")}</div>
            <div className="admin-stat-value">{mergedSubs}</div>
            <div className="admin-stat-sub">
              {t("billing_permanent")}: {o.permanent_licenses ?? 0} · 本机流水{" "}
              {localPay.count} 笔
            </div>
          </div>
          <div className="admin-stat-card" style={{ borderLeft: "3px solid #60a5fa" }}>
            <div className="admin-stat-label">{t("admin_total_users")}</div>
            <div className="admin-stat-value">{o.total_users ?? 0}</div>
            <div className="admin-stat-sub">
              {t("admin_total_visits")}: {o.total_visits ?? 0}
            </div>
          </div>
          <div className="admin-stat-card" style={{ borderLeft: "3px solid #a78bfa" }}>
            <div className="admin-stat-label">{t("admin_today_recognitions")}</div>
            <div className="admin-stat-value">{o.today_recognitions ?? 0}</div>
            <div className="admin-stat-sub">
              {t("admin_model_calls")}: {o.model_calls ?? 0}
            </div>
          </div>
          <div className="admin-stat-card" style={{ borderLeft: "3px solid #ef4444" }}>
            <div className="admin-stat-label">{t("admin_error_rate")}</div>
            <div className="admin-stat-value">{(o.error_rate_pct ?? 0)}%</div>
            <div className="admin-stat-sub">
              {t("admin_model_errors")}: {o.model_errors ?? 0}
            </div>
          </div>
          <div className="admin-stat-card" style={{ borderLeft: "3px solid #fbbf24" }}>
            <div className="admin-stat-label">{t("admin_vision_logs")}</div>
            <div className="admin-stat-value">{data.logs.length}</div>
            <div className="admin-stat-sub">{t("admin_auto_refresh")}</div>
          </div>
        </div>
      );
    if (tab === "traffic")
      return (
        <div>
          <div className="admin-overview-grid">
            <div className="admin-stat-card" style={{ borderLeft: "3px solid #60a5fa" }}>
              <div className="admin-stat-label">{t("admin_total_visits")}</div>
              <div className="admin-stat-value">{tr.total_visits ?? 0}</div>
            </div>
            <div className="admin-stat-card" style={{ borderLeft: "3px solid #34d399" }}>
              <div className="admin-stat-label">{t("admin_today_visits")}</div>
              <div className="admin-stat-value">{tr.today_visits ?? 0}</div>
            </div>
            <div className="admin-stat-card" style={{ borderLeft: "3px solid #a78bfa" }}>
              <div className="admin-stat-label">{t("admin_unique_ips")}</div>
              <div className="admin-stat-value">{tr.unique_ips ?? 0}</div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">{t("admin_recent_ips")}</div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>IP</th>
                    <th>{t("admin_visits")}</th>
                    <th>{t("admin_last_seen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(tr.recent_ips || []).map((r: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "monospace" }}>{r.ip}</td>
                      <td>{r.count}</td>
                      <td style={{ fontSize: 11 }}>{fmt(r.last_seen)}</td>
                    </tr>
                  ))}
                  {!(tr.recent_ips || []).length && (
                    <tr>
                      <td colSpan={3} style={{ color: "#64748b" }}>
                        {t("admin_no_data")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">{t("admin_recent_visits")}</div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t("admin_time")}</th>
                    <th>IP</th>
                    <th>{t("admin_path")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(tr.recent_visits || []).map((v: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontSize: 11 }}>{fmt(v.ts)}</td>
                      <td style={{ fontFamily: "monospace" }}>{v.ip}</td>
                      <td style={{ fontSize: 11 }}>{v.path}</td>
                    </tr>
                  ))}
                  {!(tr.recent_visits || []).length && (
                    <tr>
                      <td colSpan={3} style={{ color: "#64748b" }}>
                        {t("admin_no_data")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    if (tab === "logs")
      return (
        <div className="card">
          <div className="card-title">{t("admin_vision_logs")}</div>
          <div className="admin-table-wrap" style={{ maxHeight: 480, overflowY: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("admin_time")}</th>
                  <th>{t("admin_hit_provider")}</th>
                  <th>{t("admin_hit_model")}</th>
                  <th>{t("admin_status")}</th>
                  <th>{t("admin_latency")}</th>
                  <th>结果 / 错误</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((l: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontSize: 11 }}>{fmt(l.ts)}</td>
                    <td>{l.label || l.provider}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                      {l.model || "-"}
                    </td>
                    <td>
                      <span className={`admin-status ${l.status < 400 ? "active" : "error"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td>{l.latency_ms}ms</td>
                    <td style={{ fontSize: 11 }}>
                      {l.error || (l.count != null ? `${l.count} 种食物` : "")}
                    </td>
                  </tr>
                ))}
                {!data.logs.length && (
                  <tr>
                    <td colSpan={6} style={{ color: "#64748b" }}>
                      {t("admin_no_logs")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      );
    if (tab === "revenue")
      return (
        <div>
          <div className="admin-overview-grid">
            <div className="admin-stat-card" style={{ borderLeft: "3px solid #f59e0b" }}>
              <div className="admin-stat-label">{t("admin_total_revenue")}</div>
              <div className="admin-stat-value">${mergedRevenue.toFixed(2)}</div>
              <div className="admin-stat-sub">
                {t("admin_invoices")}: {mergedInvoices}
              </div>
            </div>
            <div className="admin-stat-card" style={{ borderLeft: "3px solid #60a5fa" }}>
              <div className="admin-stat-label">{t("admin_subscription_revenue")}</div>
              <div className="admin-stat-value">
                ${Number(rev.breakdown?.subscription || 0).toFixed(2)}
              </div>
            </div>
            <div className="admin-stat-card" style={{ borderLeft: "3px solid #a78bfa" }}>
              <div className="admin-stat-label">{t("admin_license_revenue")}</div>
              <div className="admin-stat-value">
                ${Number(rev.breakdown?.license || 0).toFixed(2)}
              </div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">{t("admin_recent_payments")}</div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t("admin_time")}</th>
                    <th>订单</th>
                    <th>渠道</th>
                    <th>方案</th>
                    <th>金额</th>
                  </tr>
                </thead>
                <tbody>
                  {allPayments.map((p: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontSize: 11 }}>{fmt(p.created_at)}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>
                        {p.order_id}
                      </td>
                      <td style={{ fontSize: 11 }}>{p.provider}</td>
                      <td>{p.plan}</td>
                      <td>${Number(p.amount || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {!allPayments.length && (
                    <tr>
                      <td colSpan={5} style={{ color: "#64748b" }}>
                        {t("admin_no_data")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    if (tab === "users")
      return (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>邮箱</th>
                <th>方案</th>
                <th>渠道</th>
                <th>状态</th>
                <th>到期时间</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u: any, i: number) => (
                <tr key={i}>
                  <td className="admin-cell-id">{u.id}</td>
                  <td style={{ fontSize: 11 }}>{u.email}</td>
                  <td>
                    {u.license_type === "permanent"
                      ? t("billing_permanent")
                      : u.subscription_plan}
                  </td>
                  <td style={{ fontSize: 11 }}>{u.provider}</td>
                  <td>
                    <span className={`admin-status ${u.is_active ? "active" : ""}`}>
                      {u.is_active ? "active" : "inactive"}
                    </span>
                  </td>
                  <td style={{ fontSize: 11 }}>{fmt(u.current_period_end)}</td>
                </tr>
              ))}
              {!data.users.length && (
                <tr>
                  <td colSpan={6} style={{ color: "#64748b" }}>
                    {t("admin_no_data")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    if (tab === "models")
      return (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>调用次数</th>
                <th>错误</th>
                <th>错误率</th>
                <th>延迟</th>
              </tr>
            </thead>
            <tbody>
              {(data.models?.models || []).map((m: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{m.name}</td>
                  <td>{m.calls}</td>
                  <td style={{ color: m.errors > 0 ? "#ef4444" : "#34d399" }}>
                    {m.errors}
                  </td>
                  <td>{m.error_rate_pct}%</td>
                  <td>{m.avg_latency_ms}ms</td>
                </tr>
              ))}
              {!(data.models?.models || []).length && (
                <tr>
                  <td colSpan={5} style={{ color: "#64748b" }}>
                    {t("admin_no_data")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    if (tab === "config")
      return (
        <div>
          <div className="admin-config-form">
            <h4>{t("admin_system_config")}</h4>
            <div
              style={{
                background: "#0b0d14",
                padding: 12,
                borderRadius: 8,
                fontSize: 12,
                color: "#94a3b8",
              }}
            >
              <div>ai_provider: A→B→C (Gemini / OpenRouter / DeepSeek)</div>
              <div>max_recognitions_per_day: 10</div>
              <div>waf_rate_limit: 6 req/min/IP</div>
              <div>test_price: $1.00</div>
            </div>
          </div>
        </div>
      );
    return null;
  }
  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <h2>{t("admin_title")}</h2>
        <div className="admin-header-right">
          <span className="admin-user">
            {session.displayName || session.username} ({session.role})
          </span>
          <button className="admin-logout-btn" onClick={load} disabled={refreshing}>
            {refreshing ? "…" : t("admin_refresh")}
          </button>
          <button className="admin-logout-btn" onClick={onLogout}>
            {t("admin_logout")}
          </button>
        </div>
      </div>
      <div className="admin-tabs">
        {[
          { id: "overview", labelKey: "admin_tab_overview" },
          { id: "traffic", labelKey: "admin_tab_traffic" },
          { id: "logs", labelKey: "admin_tab_logs" },
          { id: "revenue", labelKey: "admin_tab_revenue" },
          { id: "users", labelKey: "admin_tab_users" },
          { id: "models", labelKey: "admin_tab_models" },
          { id: "config", labelKey: "admin_tab_config" },
        ].map((tabItem) => (
          <button
            key={tabItem.id}
            className={`admin-tab ${tab === tabItem.id ? "active" : ""}`}
            onClick={() => setTab(tabItem.id)}
          >
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>
      <div className="admin-content">
        <TabContent />
      </div>
    </div>
  );
}
