import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";

const configStore: Record<string, string> = {
  ai_provider: "gpt-4o",
  max_recognitions_per_day: "10",
};

export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ config: configStore });
}

export async function POST(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const value = searchParams.get("value");
  if (key) configStore[key] = value || "";
  return NextResponse.json({ status: "ok", config: configStore });
}
