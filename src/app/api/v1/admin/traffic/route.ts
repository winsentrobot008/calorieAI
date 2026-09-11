import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { getVisitStats } from "@/lib/db";
import {
  TRAFFIC_ALLOWED_DAYS,
  TRAFFIC_DEFAULT_DAYS,
  getTrafficSeries,
} from "@/lib/traffic-analytics";

/**
 * GET /api/v1/admin/traffic
 *
 * 流量与 IP 监控：总访问量 / 今日访问 / 独立 IP / 最近 IP 列表 / 最近访问记录。
 * `?days=7|30` 附带每日请求分类统计（文本分析 / 识图分析 / 429 拦截 / 独立访客）。
 */
export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const requested = Number(searchParams.get("days"));
  const days = (TRAFFIC_ALLOWED_DAYS as number[]).includes(requested)
    ? requested
    : TRAFFIC_DEFAULT_DAYS;

  const [stats, daily] = await Promise.all([getVisitStats(), getTrafficSeries(days)]);

  return NextResponse.json({ ...stats, days, allowed_days: TRAFFIC_ALLOWED_DAYS, daily });
}
