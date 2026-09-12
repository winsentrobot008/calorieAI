import { NextRequest, NextResponse } from "next/server";
import { getCreditPack, resolvePack, type CreditPack } from "@/lib/credit-packs";
import { getLocalizedPaymentItem } from "@/lib/stripe-i18n";

const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com";

/**
 * GET a PayPal access token (OAuth2)
 */
async function getAccessToken(): Promise<string> {
  // PayPal uses client_id:secret for Basic Auth (OAuth2)
  const basicAuth = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PayPal auth failed: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.access_token;
}

/**
 * POST /api/paypal/create-order
 *
 * 按 Credits Top-up 积分包创建一次性 PayPal 订单。
 *
 * Body: { pack_id: "pack_starter" | "pack_booster" | "pack_power",
 *         locale?, current_lang? }
 * 商品名 / 描述统一经商业引擎 stripe-i18n 产出（EN 零汉字），
 * 不再在路由内硬编码中文商品文案。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pack: CreditPack | undefined = body.pack_id ? getCreditPack(body.pack_id) : resolvePack(body.plan);
    if (!pack) {
      return NextResponse.json({ error: `未知积分包: ${body.pack_id}` }, { status: 400 });
    }

    // 商品名 / 描述与前端语言联动（统一走商业引擎 stripe-i18n）
    const item = getLocalizedPaymentItem(pack.id, body.locale || body.current_lang || "en");

    // ── Demo / Mock mode ──────────────────────────────
    if (
      !PAYPAL_CLIENT_ID ||
      PAYPAL_CLIENT_ID === "YOUR_PAYPAL_CLIENT_ID_HERE" ||
      !PAYPAL_CLIENT_SECRET ||
      PAYPAL_CLIENT_SECRET === "YOUR_PAYPAL_CLIENT_SECRET_HERE"
    ) {
      return NextResponse.json({
        id: `ORDER_MOCK_${Date.now()}`,
        mock: true,
        pack_id: pack.id,
        credits: pack.credits,
        amount: pack.priceUsd,
        amount_cny: pack.priceCny,
        currency: "CNY",
        message: "演示模式：未配置完整的 PayPal 密钥。设置 PAYPAL_CLIENT_ID 和 PAYPAL_CLIENT_SECRET 启用真实支付。",
      });
    }

    // ── Get access token ──────────────────────────────
    const accessToken = await getAccessToken();

    // ── Create PayPal order ───────────────────────────
    // 定价基准为人民币（1 RMB = 1 Credit）；PayPal 不支持 CNY 收款，
    // 故按固定基准汇率折算为 USD 收款（pack.priceUsd 由 pack.priceCny 推导），
    // 保证两条通道折算回人民币后与 ¥1 = 1 积分 基准完全一致。
    const orderRes = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: pack.id,
            description: item.description,
            amount: {
              currency_code: "USD",
              value: pack.priceUsd.toFixed(2),
              breakdown: {
                item_total: {
                  currency_code: "USD",
                  value: pack.priceUsd.toFixed(2),
                },
              },
            },
            items: [
              {
                name: item.name,
                description: item.description,
                unit_amount: {
                  currency_code: "USD",
                  value: pack.priceUsd.toFixed(2),
                },
                quantity: "1",
                category: "DIGITAL_GOODS",
              },
            ],
          },
        ],
        application_context: {
          brand_name: "CalorieAI",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      throw new Error(`PayPal order creation failed: ${err.slice(0, 300)}`);
    }

    const order = await orderRes.json();
    return NextResponse.json({
      id: order.id,
      pack_id: pack.id,
      credits: pack.credits,
      amount: pack.priceUsd,
      amount_cny: pack.priceCny,
      currency: "CNY",
    });
  } catch (error: any) {
    console.error("[PayPal Create Order Error]", error);
    return NextResponse.json(
      { error: error.message || "创建 PayPal 订单失败" },
      { status: 500 },
    );
  }
}
