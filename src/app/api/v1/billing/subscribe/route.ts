import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/v1/billing/subscribe（已停用）
 *
 * 商业化已切换为 Credits Top-up（积分充值/按次付费）一次性付款：
 *   - Stripe：由 /api/stripe/webhook（checkout.session.completed）直接发放积分；
 *   - PayPal：由 /api/paypal/capture-order 捕获成功后直接发放积分。
 * 本订阅激活接口不再使用，返回 410 防止旧客户端误调用。
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      error: "DEPRECATED",
      detail: "订阅接口已停用：商业化已切换为 Credits Top-up 一次性积分充值，请使用积分包支付。",
    },
    { status: 410 }
  );
}
