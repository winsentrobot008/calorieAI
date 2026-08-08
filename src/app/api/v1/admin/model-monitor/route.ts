import { NextResponse } from "next/server";
import { getVisionStats } from "@/lib/db";

export async function GET() {
  const stats = await getVisionStats();
  return NextResponse.json({
    total_calls: stats.total_calls,
    today_calls: stats.today_calls,
    errors: stats.errors,
    error_rate_pct: stats.error_rate_pct,
    models: stats.by_provider.map((m) => ({
      name: m.model ? `${m.name}:${m.model}` : m.name,
      calls: m.calls,
      errors: m.errors,
      error_rate_pct: m.calls ? Math.round((m.errors / m.calls) * 1000) / 10 : 0,
      avg_latency_ms: m.avg_latency_ms,
    })),
  });
}
