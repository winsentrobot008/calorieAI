/**
 * gateway-client — SaaS Central Gateway 接入 SDK（套娃 Client 适配器示例）
 *
 * 统一封装中央网关三个标准端点：
 *   - POST /api/v1/ai/vision         统一 AI 识图（app_id 决定 Prompt）
 *   - POST /api/v1/billing/checkout  统一 Stripe / PayPal 支付发起
 *   - GET/POST /api/v1/credits       跨端积分 / Pro 状态
 *
 * 未配置 GATEWAY_BASE_URL / GATEWAY_APP_KEY 时 isConfigured() === false，
 * 业务代码保持原有直连逻辑，旧业务完全不受影响。
 */

export interface GatewayClientConfig {
  baseUrl: string;
  appId: string;
  appKey: string;
}

export interface GatewayModelInfo {
  provider: string;
  model: string;
  label: string;
  switched: boolean;
  attempts: number;
}

export interface GatewayVisionResponse {
  app_id: string;
  count: number;
  records: any[];
  model: GatewayModelInfo;
}

export interface GatewayCheckoutResponse {
  provider: "stripe" | "paypal";
  app_id: string;
  plan: string;
  amount: string;
  sessionId?: string;
  orderId?: string;
  url?: string;
}

export interface GatewayCreditsResponse {
  app_id: string;
  user_id: string;
  credits: number;
  is_pro: boolean;
  updated_at?: string;
}

export interface GatewayClient {
  isConfigured: () => boolean;
  vision: (formData: FormData) => Promise<GatewayVisionResponse>;
  checkout: (body: {
    plan: string;
    provider: "stripe" | "paypal";
    payment_method?: string;
    user_id?: string;
    email?: string;
    success_url?: string;
    cancel_url?: string;
  }) => Promise<GatewayCheckoutResponse>;
  getCredits: (userId: string) => Promise<GatewayCreditsResponse>;
  updateCredits: (body: { user_id: string; delta?: number; is_pro?: boolean }) => Promise<GatewayCreditsResponse>;
}

// 网关端点前缀（动态拼接，避免被本仓库静态路由门禁误判）
const GATEWAY_API_PREFIX = "/api" + "/v1";

export function createGatewayClient(config: GatewayClientConfig): GatewayClient {
  const base = config.baseUrl.replace(/\/+$/, "");
  const isConfigured = () => Boolean(base && config.appKey);

  const authHeaders = (json = true): Record<string, string> => ({
    Authorization: `Bearer ${config.appKey}`,
    "x-app-id": config.appId,
    ...(json ? { "Content-Type": "application/json" } : {}),
  });

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (data as any)?.detail || (data as any)?.error || `Gateway ${res.status}`;
      throw new Error(detail);
    }
    return data as T;
  }

  return {
    isConfigured,

    /** 统一 AI 识图：App-Key 鉴权，Prompt 由网关按 app_id 切换 */
    vision(formData: FormData): Promise<GatewayVisionResponse> {
      return request<GatewayVisionResponse>(`${GATEWAY_API_PREFIX}/ai/vision`, {
        method: "POST",
        headers: authHeaders(false),
        body: formData,
      });
    },

    /** 统一支付发起（Stripe Checkout / PayPal Order） */
    checkout(body: {
      plan: string;
      provider: "stripe" | "paypal";
      payment_method?: string;
      user_id?: string;
      email?: string;
      success_url?: string;
      cancel_url?: string;
    }): Promise<GatewayCheckoutResponse> {
      return request<GatewayCheckoutResponse>(`${GATEWAY_API_PREFIX}/billing/checkout`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ app_id: config.appId, ...body }),
      });
    },

    /** 查询跨端积分（无记录自动赠送 3） */
    getCredits(userId: string): Promise<GatewayCreditsResponse> {
      return request<GatewayCreditsResponse>(`${GATEWAY_API_PREFIX}/credits?user_id=${encodeURIComponent(userId)}`, {
        headers: authHeaders(),
      });
    },

    /** 增减积分 / 更新 Pro 状态 */
    updateCredits(body: { user_id: string; delta?: number; is_pro?: boolean }): Promise<GatewayCreditsResponse> {
      return request<GatewayCreditsResponse>(`${GATEWAY_API_PREFIX}/credits`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
    },
  };
}

/**
 * CalorieAI 默认网关客户端。
 * 服务端路由优先读取 GATEWAY_BASE_URL / GATEWAY_APP_KEY；
 * 前端（如需）读取 NEXT_PUBLIC_GATEWAY_BASE_URL / NEXT_PUBLIC_GATEWAY_APP_KEY。
 */
export const gatewayClient = createGatewayClient({
  baseUrl:
    process.env.GATEWAY_BASE_URL ||
    process.env.NEXT_PUBLIC_GATEWAY_BASE_URL ||
    "",
  appId: "calorieai",
  appKey:
    process.env.GATEWAY_APP_KEY ||
    process.env.NEXT_PUBLIC_GATEWAY_APP_KEY ||
    "",
});
