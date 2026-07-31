"use client";

import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { t, useLocale } from "@/lib/i18n";

export default function BillingCancelPage() {
  useLocale();
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0c14] px-4">
      <div className="card max-w-md w-full text-center py-12">
        <XCircle className="h-16 w-16 mx-auto text-zinc-500 mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">{t("billing_cancel_title")}</h1>
        <p className="text-sm text-zinc-400 mb-2">
          {t("billing_cancel_hint")}
        </p>
        <p className="text-xs text-zinc-500 mb-6">
          {t("billing_cancel_free_hint")}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            className="btn-secondary px-5 py-2 rounded-lg"
            onClick={() => router.push("/")}
          >
            {t("back_home")}
          </button>
          <button
            className="btn-primary px-5 py-2 rounded-lg"
            onClick={() => router.push("/?upgrade=true")}
          >
            {t("rechoose_plan")}
          </button>
        </div>
      </div>
    </div>
  );
}
