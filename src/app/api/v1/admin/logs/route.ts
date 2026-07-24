import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    logs: [
      { id: "log_001", created_at: new Date().toISOString(), admin_id: "admin_001", action: "update_config", target_type: "config", target_id: "ai_provider", details: { key: "ai_provider", value: "gpt-4o" } },
      { id: "log_002", created_at: new Date(Date.now() - 3600000).toISOString(), admin_id: "admin_001", action: "ban_user", target_type: "user", target_id: "user_042", details: { reason: "abuse" } },
    ],
  });
}
