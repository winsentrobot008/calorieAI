"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { t, useLocale } from "@/lib/i18n";
import { getCreditPack } from "@/lib/credit-packs";
import {
  recordLocalPayment,
  addCredits,
  writeCredits,
  writeProFlag,
} from "@/lib/local-store";

function BillingSuccessContent() {
  useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");

  // 演示模式入账：无 Webhook，本地到账 + 服务端同步（仅 mock 路径使用）
  const applyMockTopup = (packId: string | null, creditsParam: string | null) => {
    try {
      const pack = getCreditPack(packId);
      const credits = pack ? pack.credits : Number(creditsParam || 0) || 10;
      const amount = pack ? pack.priceUsd : 1.0;
      // 记录本机支付流水供管理员后台合并展示
      recordLocalPayment({
        orderId: searchParams.get("session_id") || `stripe_${Date.now()}`,
        provider: "stripe",
        plan: pack ? pack.id : packId || "pack_starter",
        amount,
      });
      const next = addCredits(credits);
      // 同步服务器持久化积分（跨设备一致）
      const uid = localStorage.getItem("user_id") || "anonymous";
      fetch("/api/v1/user/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, delta: credits, action: "purchase" }),
      }).catch(() => {});
      console.log(`[BillingSuccess] 积分包到账 +${credits} 积分，余额 ${next}`);
    } catch (err) {
      console.error("[BillingSuccess] mock 入账失败:", err);
    }
  };

  /**
   * 真实支付路径：以服务端 Webhook 入账为唯一权威，轮询 /api/v1/user/credits
   * 直到余额达到预期（最多约 12s），期间不做任何本地二次入账，杜绝双加积分。
   */
  const verifyServerCredits = async (
    packId: string | null,
    creditsParam: string | null
  ): Promise<number | null> => {
    const uid = localStorage.getItem("user_id") || "anonymous";
    const pack = getCreditPack(packId);
    const expected = pack ? pack.credits : Number(creditsParam || 0) || 10;
    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(`/api/v1/user/credits?user_id=${encodeURIComponent(uid)}`);
        const d = await res.json();
        if (d && typeof d.credits === "number") {
          // 服务端真库数据回写本地缓存，保证刷新后展示一致
          writeCredits(d.credits);
          writeProFlag(!!d.is_pro);
          if (d.credits >= expected) return d.credits;
        }
      } catch {
        /* 轮询失败继续重试 */
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    return null;
  };

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const packId = searchParams.get("pack_id");
    const creditsParam = searchParams.get("credits");
    const isMock = searchParams.get("mock") === "true";

    if (isMock) {
      applyMockTopup(packId, creditsParam);
      setStatus("success");
      setMessage(t("billing_success_credits", { credits: creditsParam || "10" }));
      return;
    }

    if (!sessionId) {
      setStatus("error");
      setMessage(t("billing_success_missing_session"));
      return;
    }

    // 真实支付：仅以服务端 Webhook 入账为准，轮询确认后再展示成功
    setStatus("verifying");
    (async () => {
      const confirmed = await verifyServerCredits(packId, creditsParam);
      setStatus("success");
      setMessage(
        confirmed != null
          ? t("billing_success_credits_confirmed", { credits: confirmed })
          : t("billing_success_credits_pending")
      );
    })();
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0c14] px-4">
      <div className="card max-w-md w-full text-center py-12">
        {status === "verifying" && (
          <>
            <Loader2 className="h-16 w-16 mx-auto text-blue-400 animate-spin mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">{t("billing_success_verifying")}</h1>
            <p className="text-sm text-zinc-400">{t("billing_success_verifying_hint")}</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="h-16 w-16 mx-auto text-green-400 mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">{t("billing_success_title")}</h1>
            <p className="text-sm text-zinc-400 mb-6">{message}</p>
            <button
              className="btn-primary px-6 py-2 rounded-lg"
              onClick={() => router.push("/")}
            >
              {t("back_home")}
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="h-16 w-16 mx-auto text-red-400 mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">{t("verification_failed")}</h1>
            <p className="text-sm text-zinc-400 mb-2">{message}</p>
            <p className="text-xs text-zinc-500 mb-6">
              {t("verification_failed_hint")}
            </p>
            <button
              className="btn-primary px-6 py-2 rounded-lg"
              onClick={() => router.push("/")}
            >
              {t("back_home")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#0a0c14]">
          <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
        </div>
      }
    >
      <BillingSuccessContent />
    </Suspense>
  );
}
