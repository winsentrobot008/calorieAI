import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return NextResponse.json({
    status: "ok",
    message: "广告观看成功！获得 +1 次识别机会",
    rewarded: true,
  });
}
