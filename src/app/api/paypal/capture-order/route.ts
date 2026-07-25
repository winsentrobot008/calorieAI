import { NextRequest, NextResponse } from "next/server";

const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com";

/**
 * GET a PayPal access token
 */
async function getAccessToken(): Promise<string> {
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
 * POST /api/paypal/capture-order
 *
 * Captures a PayPal order after the buyer approves it on the frontend.
 *
 * Body: { orderId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json({ error: "缺少 orderId" }, { status: 400 });
    }

    // ── Demo / Mock mode ──────────────────────────────
    if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === "YOUR_PAYPAL_CLIENT_ID_HERE") {
      return NextResponse.json({
        status: "COMPLETED",
        id: orderId,
        mock: true,
        purchase_units: [{ payments: { captures: [{ id: `CAP_MOCK_${Date.now()}`, amount: { value: "0.00" } }] } }],
      });
    }

    // ── Get access token ──────────────────────────────
    const accessToken = await getAccessToken();

    // ── Capture the order ─────────────────────────────
    const captureRes = await fetch(
      `${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!captureRes.ok) {
      const err = await captureRes.text();
      throw new Error(`PayPal capture failed: ${err.slice(0, 300)}`);
    }

    const capture = await captureRes.json();

    // Log successful payment for record-keeping
    console.log("[PayPal Capture] Order captured:", {
      orderId: capture.id,
      status: capture.status,
      payer: capture.payer?.email_address,
      amount: capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      status: capture.status,
      id: capture.id,
      captureId: capture.purchase_units?.[0]?.payments?.captures?.[0]?.id,
      payer_email: capture.payer?.email_address,
      amount: capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount,
    });
  } catch (error: any) {
    console.error("[PayPal Capture Order Error]", error);
    return NextResponse.json(
      { error: error.message || "捕获 PayPal 订单失败" },
      { status: 500 },
    );
  }
}
