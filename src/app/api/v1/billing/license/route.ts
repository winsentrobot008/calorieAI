import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/v1/billing/license（已停用）
 *
 * 旧“永久买断”授权接口。商业化已切换为 Credits Top-up 一次性积分充值，
 * 本接口返回 410 防止旧客户端误调用。
 */
export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      error: "DEPRECATED",
      detail: "永久买断接口已停用：商业化已切换为 Credits Top-up 一次性积分充值。",
    },
    { status: 410 }
  );
}
