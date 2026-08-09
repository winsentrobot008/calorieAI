"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { t, useLocale } from "@/lib/i18n";
import { getCreditPack } from "@/lib/credit-packs";
import { recordLocalPayment, addCredits } from "@/lib/local-store";

function BillingSuccessContent() {
  useLocale();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");

  // 支付成功后本地积分包到账（Credits Top-up，无订阅；服务端 Webhook 为权威入账）
  const applyLocalTopup = (packId: string | null, creditsParam: string | null) => {
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
      console.error("[BillingSuccess] localStorage 写入失败:", err);
    }
  };

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const packId = searchParams.get("pack_id");
    const creditsParam = searchParams.get("credits");
    const isMock = searchParams.get("mock") === "true";

    if (isMock) {
      applyLocalTopup(packId, creditsParam);
      setStatus("success");
      setMessage(t("billing_success_credits", { credits: creditsParam || "10" }));
      return;
    }

    if (!sessionId) {
      setStatus("error");
      setMessage(t("billing_success_missing_session"));
      return;
    }

    // 本地即时到账（Webhook 会在服务端权威入账，幂等去重）
    applyLocalTopup(packId, creditsParam);
    setStatus("success");
    setMessage(t("billing_success_credits", { credits: creditsParam || "10" }));
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
