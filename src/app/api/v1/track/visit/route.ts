import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/anti-crawler";
import { db } from "@/lib/db";
import { recordTrafficEvent } from "@/lib/traffic-analytics";

/**
 * POST /api/v1/track/visit
 *
 * 前端页面挂载后上报一次访问（best-effort）：
 * 服务端记录 IP / User-Agent / 路径，供管理后台流量与 IP 监控使用。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ip = getClientIp(request);
    await db.recordVisit({
      ip,
      ua: request.headers.get("user-agent") || "",
      path: body.path || "/",
    });
    // 每日独立访客（IP）统计：仅登记访客集合，不计入请求分类
    await recordTrafficEvent("visit", ip);
    return NextResponse.json({ status: "ok" });
  } catch (error: any) {
    console.error("[Track Visit Error]", error);
    return NextResponse.json({ error: "记录失败" }, { status: 500 });
  }
}
