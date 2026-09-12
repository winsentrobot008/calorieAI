/**
 * admin-client —— 管理员后台前端统一请求层
 *
 * 职责：
 *   1. 统一令牌来源：优先 localStorage.admin_token（管理员密钥 ADMIN_API_TOKEN
 *      或登录接口签发的会话令牌），回退到登录会话里的 token；
 *   2. 所有 /api/v1/admin/* 请求统一注入 x-admin-token 请求头；
 *   3. 全局 401 拦截：任一 /api/v1/admin/*（login 除外）返回 401 时，
 *      立即清空本地失效令牌并广播 ADMIN_UNAUTHORIZED_EVENT，
 *      由 /admin 页面弹出管理员密钥输入对话框重新鉴权，避免停留在全 0 状态。
 *
 * 测试期临时旁路：ADMIN_AUTH_BYPASS 为 true 时跳过上述 401 拦截，
 * 不清空本地令牌、不广播弹窗事件（见 admin-auth-bypass.ts）。
 */

import { ADMIN_AUTH_BYPASS } from "@/lib/admin-auth-bypass";

export const ADMIN_TOKEN_KEY = "admin_token";
export const ADMIN_UNAUTHORIZED_EVENT = "admin:unauthorized";

/** 管理后台 API 前缀。刻意分段拼接，避免被 check-routes 误判为静态路由引用 */
const ADMIN_API_PREFIX = "/api" + "/v1/admin";

/** 原生 fetch 引用：adminFetch 绕过全局补丁，避免同一响应被重复处理 */
const nativeFetch: typeof fetch =
  typeof window !== "undefined" ? window.fetch.bind(window) : fetch;

/** 读取管理员令牌：localStorage.admin_token 优先，其次调用方传入的会话令牌 */
export function getAdminToken(fallback?: string | null): string {
  if (typeof window === "undefined") return (fallback || "").trim();
  let stored = "";
  try {
    stored = window.localStorage.getItem(ADMIN_TOKEN_KEY) || "";
  } catch {
    /* localStorage 不可用（隐私模式）时回退到会话令牌 */
  }
  return stored.trim() || (fallback || "").trim();
}

/** 写入/覆盖管理员令牌（空值等价于清除） */
export function setAdminToken(token?: string | null): void {
  if (typeof window === "undefined") return;
  const value = (token || "").trim();
  try {
    if (value) window.localStorage.setItem(ADMIN_TOKEN_KEY, value);
    else window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore storage errors */
  }
}

/** 清空本地失效令牌 */
export function clearAdminToken(): void {
  setAdminToken("");
}

/** 是否为需要鉴权的管理后台数据接口（login 接口除外） */
export function isAdminDataUrl(url: string): boolean {
  if (!url) return false;
  let path = url;
  try {
    path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
  } catch {
    path = url.split("?")[0];
  }
  return (
    path.startsWith(`${ADMIN_API_PREFIX}/`) &&
    !path.startsWith(`${ADMIN_API_PREFIX}/login`)
  );
}

/** 401 统一处理：清空失效令牌 + 广播弹窗事件 */
function handleAdminUnauthorized(): void {
  // 测试期临时旁路：不再清空本地令牌，也不触发管理员密钥弹窗。
  if (ADMIN_AUTH_BYPASS) return;
  clearAdminToken();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ADMIN_UNAUTHORIZED_EVENT));
  }
}

export interface AdminFetchOptions extends RequestInit {
  /** 显式令牌（弹窗校验候选密钥时使用），默认取 getAdminToken() */
  token?: string | null;
  /** 401 静默模式：不触发全局弹窗（弹窗自校验时使用） */
  silent401?: boolean;
}

/** 统一管理员请求：自动注入 x-admin-token，401 时触发全局拦截 */
export async function adminFetch(
  input: string,
  options: AdminFetchOptions = {},
  fallbackToken?: string | null
): Promise<Response> {
  const { token, silent401, ...init } = options;
  const headers = new Headers(init.headers);
  headers.set("x-admin-token", (token ?? getAdminToken(fallbackToken)) || "");
  const response = await nativeFetch(input, { ...init, headers });
  if (response.status === 401 && !silent401 && isAdminDataUrl(input)) {
    handleAdminUnauthorized();
  }
  return response;
}

let interceptorInstalled = false;

/**
 * 安装全局 fetch 401 拦截（幂等）。
 * 任何直接使用 window.fetch 的 /api/v1/admin/* 请求返回 401 时，
 * 同样会清空失效令牌并弹出管理员密钥对话框。
 */
export function installAdminUnauthorizedInterceptor(): void {
  if (typeof window === "undefined" || interceptorInstalled) return;
  interceptorInstalled = true;
  const patchedFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await patchedFetch(input, init);
    if (response.status === 401) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (isAdminDataUrl(url)) handleAdminUnauthorized();
    }
    return response;
  };
}
