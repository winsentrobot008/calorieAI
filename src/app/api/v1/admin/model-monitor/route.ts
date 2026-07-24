import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    total_calls: 892,
    models: [
      { name: "gpt-4o", calls: 320, errors: 2, error_rate_pct: 0.6, avg_latency_ms: 1200, total_tokens: 45000 },
      { name: "claude-3.5", calls: 280, errors: 4, error_rate_pct: 1.4, avg_latency_ms: 980, total_tokens: 38000 },
      { name: "gemini-pro", calls: 180, errors: 3, error_rate_pct: 1.7, avg_latency_ms: 850, total_tokens: 22000 },
      { name: "deepseek", calls: 112, errors: 2, error_rate_pct: 1.8, avg_latency_ms: 760, total_tokens: 15000 },
    ],
  });
}
