import { NextResponse } from "next/server";
import { getVisitStats } from "@/lib/db";

/**
 * GET /api/v1/admin/traffic
 *
 * 流量与 IP 监控：总访问量 / 今日访问 / 独立 IP / 最近 IP 列表 / 最近访问记录。
 */
export async function GET() {
  return NextResponse.json(await getVisitStats());
}
