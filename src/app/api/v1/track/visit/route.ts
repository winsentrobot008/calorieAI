import { NextRequest, NextResponse } from "next/server";
import { recordVisit } from "@/lib/analytics-store";
import { getClientIp } from "@/lib/anti-crawler";

/**
 * POST /api/v1/track/visit
 *
 * 前端页面挂载后上报一次访问（best-effort）：
 * 服务端记录 IP / User-Agent / 路径，供管理后台流量与 IP 监控使用。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    recordVisit({
      ip: getClientIp(request),
      ua: request.headers.get("user-agent") || "",
      path: body.path || "/",
    });
    return NextResponse.json({ status: "ok" });
  } catch (error: any) {
    console.error("[Track Visit Error]", error);
    return NextResponse.json({ error: "记录失败" }, { status: 500 });
  }
}
