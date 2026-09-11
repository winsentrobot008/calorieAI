import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/lib/admin-auth";
import {
  FEATURE_FLAG_KEYS,
  getFeatureFlags,
  isFeatureFlagKey,
  parseFlagInput,
  setFeatureEnabled,
} from "@/lib/feature-flags";

const configStore: Record<string, string> = {
  ai_provider: "gpt-4o",
  max_recognitions_per_day: "10",
};

/** 当前功能开关状态（KV 实时读取，未配置时回退进程内默认值） */
async function flagPayload() {
  return {
    config: configStore,
    flags: await getFeatureFlags(),
  };
}

/**
 * GET /api/v1/admin/config
 *
 * 返回静态配置 + 全部动态功能开关状态（管理员令牌必需）。
 */
export async function GET(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(await flagPayload());
}

/**
 * POST / PUT /api/v1/admin/config
 *
 * 管理员动态切换功能开关，实时写入 KV 存储（管理员令牌必需）：
 *   - JSON body: { key: "FEATURE_VISION_ENABLED", value: true | "true" | "on" }
 *   - 兼容查询参数: ?key=FEATURE_VISION_ENABLED&value=true
 */
async function updateFlag(request: NextRequest) {
  const auth = getAdminAuth(request);
  if (!auth.ok) return auth.response;

  const body: any = await request.json().catch(() => ({}));
  const { searchParams } = new URL(request.url);
  const key = String(body?.key ?? searchParams.get("key") ?? "").trim();
  const rawValue = body?.value ?? body?.enabled ?? searchParams.get("value");

  if (!key || !isFeatureFlagKey(key)) {
    return NextResponse.json(
      {
        error: "INVALID_FLAG_KEY",
        detail: `不支持的开关: ${key || "(空)"}`,
        supported: FEATURE_FLAG_KEYS,
      },
      { status: 400 }
    );
  }

  const enabled = parseFlagInput(rawValue);
  if (enabled === null) {
    return NextResponse.json(
      { error: "INVALID_FLAG_VALUE", detail: "开关值必须为 true / false" },
      { status: 400 }
    );
  }

  await setFeatureEnabled(key, enabled);
  console.log(`[Admin] ${auth.session.username} 切换功能开关 ${key} = ${enabled}`);

  return NextResponse.json({
    status: "ok",
    updated: { key, enabled },
    flags: await getFeatureFlags(),
    config: configStore,
  });
}

export async function POST(request: NextRequest) {
  return updateFlag(request);
}

export async function PUT(request: NextRequest) {
  return updateFlag(request);
}
