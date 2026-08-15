/**
 * turnstile — Cloudflare Turnstile 无感知人机验证（服务端校验）
 *
 * 规则：
 *   - 配置 TURNSTILE_SECRET_KEY 后强制校验 human_token，阻断脚本自动化注册/登录；
 *   - 未配置密钥（本地/演示/CI 测试模式）自动放行，保证
 *     ceo_visual_demo.py --promo-en / --mobile-demo 等自动化演示不受影响。
 */

const SECRET = process.env.TURNSTILE_SECRET_KEY;

export function isTurnstileConfigured(): boolean {
  return !!SECRET && SECRET !== "YOUR_TURNSTILE_SECRET_KEY_HERE";
}

export async function verifyTurnstileToken(
  token: string | undefined | null,
  ip?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // 测试 / 演示模式：未配置密钥时自动放行（生产配置密钥后即强制校验）
  if (!isTurnstileConfigured()) return { ok: true };
  if (!token) return { ok: false, error: "缺少人机验证 token（请稍后重试）" };

  const form = new URLSearchParams({
    secret: SECRET as string,
    response: token,
  });
  if (ip) form.set("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (data.success === true) return { ok: true };
    const codes = Array.isArray(data["error-codes"]) ? data["error-codes"].join(",") : "";
    return { ok: false, error: codes ? `人机验证失败（${codes}）` : "人机验证失败" };
  } catch (err: any) {
    console.error("[Turnstile] siteverify 请求失败:", err?.message);
    return { ok: false, error: "人机验证服务暂时不可用，请稍后重试" };
  }
}
