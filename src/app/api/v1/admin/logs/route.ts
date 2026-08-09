import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    // 实时运行日志：API 识图日志（命中模型 / 耗时 / 200·400·429·502·503 错误）
    logs: await db.getVisionLogs(200),
  });
}
