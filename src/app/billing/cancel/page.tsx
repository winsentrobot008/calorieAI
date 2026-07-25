"use client";

import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";

export default function BillingCancelPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0c14] px-4">
      <div className="card max-w-md w-full text-center py-12">
        <XCircle className="h-16 w-16 mx-auto text-zinc-500 mb-4" />
        <h1 className="text-xl font-bold text-white mb-2">支付已取消</h1>
        <p className="text-sm text-zinc-400 mb-2">
          你没有产生任何扣费。如有疑问或遇到问题，可随时重新尝试。
        </p>
        <p className="text-xs text-zinc-500 mb-6">
          享受每日 3 次免费识别，升级 Pro 解锁无限次使用。
        </p>
        <div className="flex gap-3 justify-center">
          <button
            className="btn-secondary px-5 py-2 rounded-lg"
            onClick={() => router.push("/")}
          >
            返回首页
          </button>
          <button
            className="btn-primary px-5 py-2 rounded-lg"
            onClick={() => router.push("/?upgrade=true")}
          >
            重新选择方案
          </button>
        </div>
      </div>
    </div>
  );
}
