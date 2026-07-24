import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const body = await request.json();

  const userId = `oauth_${provider}_${Date.now()}`;
  return NextResponse.json({
    user_id: userId,
    email: `${provider}_user@example.com`,
    provider,
  });
}
