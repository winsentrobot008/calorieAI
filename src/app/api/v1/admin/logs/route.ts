import { NextResponse } from "next/server";
import { getVisionLogs } from "@/lib/vision-log-store";

export async function GET() {
  return NextResponse.json({
    // 实时运行日志：API 识图日志（命中模型 / 耗时 / 200·400·429·502·503 错误）
    logs: getVisionLogs(200),
  });
}
