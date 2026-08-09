import { NextRequest, NextResponse } from "next/server";
import { getCreditPack, resolvePack, type CreditPack } from "@/lib/credit-packs";

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
 * Body: { pack_id: "pack_starter" | "pack_booster" | "pack_power" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pack: CreditPack | undefined = body.pack_id ? getCreditPack(body.pack_id) : resolvePack(body.plan);
    if (!pack) {
      return NextResponse.json({ error: `未知积分包: ${body.pack_id}` }, { status: 400 });
    }

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
        message: "演示模式：未配置完整的 PayPal 密钥。设置 PAYPAL_CLIENT_ID 和 PAYPAL_CLIENT_SECRET 启用真实支付。",
      });
    }

    // ── Get access token ──────────────────────────────
    const accessToken = await getAccessToken();

    // ── Create PayPal order ───────────────────────────
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
            description: `CalorieAI ${pack.credits} 积分包（一次性付款，无订阅）`,
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
                name: `CalorieAI ${pack.credits} 积分包`,
                description: `一次性付款 · 按次付费 · ${pack.credits} 积分即时到账`,
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
    return NextResponse.json({ id: order.id, pack_id: pack.id, credits: pack.credits, amount: pack.priceUsd });
  } catch (error: any) {
    console.error("[PayPal Create Order Error]", error);
    return NextResponse.json(
      { error: error.message || "创建 PayPal 订单失败" },
      { status: 500 },
    );
  }
}
