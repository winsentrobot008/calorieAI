import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return NextResponse.json({
    status: "ok",
    message: "永久授权激活成功！",
    license_id: `lic_${Date.now()}`,
  });
}
