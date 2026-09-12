/**
 * config/flags — 公开只读功能开关快照（前端识别闸门镜像）
 *
 * 前端在发起识图上传前读取本接口，让 UI 与后端 analyze-image 使用同一套
 * KV 开关判定，避免「管理后台已打开开关、前端仍提示未开放」的错配。
 *
 * 契约：
 *   - 只读、无副作用、no-store：每次请求都实时读 KV，不缓存旧值；
 *   - 管理员豁免由服务端判定（x-admin-token 或管理员 user_id），前端不自行
 *     判断身份，避免把管理员名单下发到浏览器；
 *   - 存储不可用时按默认值降级（测试期默认放行），绝不 5xx 拖垮前端。
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-access";
import {
  FEATURE_VISION_ENABLED,
  VISION_DISABLED_CODE,
  VISION_DISABLED_MESSAGE,
  isFeatureEnabled,
} from "@/lib/feature-flags";

/** 开关必须按请求实时求值，禁止被静态化 / 缓存 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = String(
    searchParams.get("user_id") || request.headers.get("x-user-id") || ""
  ).trim();

  const adminBypass = isAdminRequest(request, userId);
  const visionEnabled = adminBypass || (await isFeatureEnabled(FEATURE_VISION_ENABLED));

  return NextResponse.json(
    {
      vision: {
        key: FEATURE_VISION_ENABLED,
        enabled: visionEnabled,
        admin_bypass: adminBypass,
        code: visionEnabled ? null : VISION_DISABLED_CODE,
        detail: visionEnabled ? "" : VISION_DISABLED_MESSAGE,
      },
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
