import { NextRequest, NextResponse } from "next/server";
import { db, addServerCredits } from "@/lib/db";
import { getCreditPack, resolvePack, type CreditPack } from "@/lib/credit-packs";

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
 * Body: { orderId: string, pack_id?: string, user_id?: string, email?: string }
 *
 * 捕获成功后服务端直接按积分包发放积分（Credits Top-up，无订阅）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId } = body;
    const userId = body.user_id || "";
    const email = body.email || "";
    const pack: CreditPack | undefined = body.pack_id ? getCreditPack(body.pack_id) : resolvePack(body.plan);
    if (!pack) {
      return NextResponse.json({ error: `未知积分包: ${body.pack_id}` }, { status: 400 });
    }

    if (!orderId) {
      return NextResponse.json({ error: "缺少 orderId" }, { status: 400 });
    }

    // ── Demo / Mock mode ──────────────────────────────
    if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === "YOUR_PAYPAL_CLIENT_ID_HERE") {
      return NextResponse.json({
        status: "COMPLETED",
        id: orderId,
        mock: true,
        pack_id: pack.id,
        credits_added: pack.credits,
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

    // 捕获成功（COMPLETED）→ 服务端直接发放积分包（无订阅）
    let creditsAdded = 0;
    if (capture.status === "COMPLETED") {
      const effectiveUserId = userId || email || `paypal_${capture.id}`;
      try {
        creditsAdded = await addServerCredits(effectiveUserId, pack.credits);
        // 按 order_id 去重记账（幂等）
        await db.recordPayment({
          orderId: capture.id,
          provider: "paypal",
          plan: pack.id,
          amount: pack.priceUsd,
          email: email || capture.payer?.email_address || "",
        });
        console.log(
          `[PayPal Capture] ✅ 积分包到账: userId=${effectiveUserId}, pack=${pack.id}, +${pack.credits} → ${creditsAdded}`
        );
      } catch (err: any) {
        console.error("[PayPal Capture] 积分发放失败:", err.message);
      }
    }

    return NextResponse.json({
      status: capture.status,
      id: capture.id,
      captureId: capture.purchase_units?.[0]?.payments?.captures?.[0]?.id,
      payer_email: capture.payer?.email_address,
      amount: capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount,
      pack_id: pack.id,
      credits_added: creditsAdded,
    });
  } catch (error: any) {
    console.error("[PayPal Capture Order Error]", error);
    return NextResponse.json(
      { error: error.message || "捕获 PayPal 订单失败" },
      { status: 500 },
    );
  }
}
