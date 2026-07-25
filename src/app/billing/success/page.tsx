"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

function BillingSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const plan = searchParams.get("plan");
    const isMock = searchParams.get("mock") === "true";

    if (isMock) {
      setStatus("success");
      setMessage(`演示模式：${plan || "月付 Pro"} 订阅成功！`);
      return;
    }

    if (!sessionId) {
      setStatus("error");
      setMessage("缺少支付会话 ID，请联系客服。");
      return;
    }

    // 验证支付状态
    fetch(`/api/v1/billing/status?session_id=${sessionId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.is_premium) {
          setStatus("success");
          setMessage("Pro 订阅已激活！尽情享用无限次 AI 食物识别 🎉");
        } else {
          // 支付可能还在处理中，Webhook 尚未触发
          setStatus("success");
          setMessage("支付成功！订阅权益将在几分钟内激活。");
        }
      })
      .catch(() => {
        setStatus("success");
        setMessage("支付成功！感谢你的订阅 ❤️");
      });
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0c14] px-4">
      <div className="card max-w-md w-full text-center py-12">
        {status === "verifying" && (
          <>
            <Loader2 className="h-16 w-16 mx-auto text-blue-400 animate-spin mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">正在验证支付...</h1>
            <p className="text-sm text-zinc-400">请稍候，我们正在确认你的订阅状态。</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="h-16 w-16 mx-auto text-green-400 mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">🎉 支付成功！</h1>
            <p className="text-sm text-zinc-400 mb-6">{message}</p>
            <button
              className="btn-primary px-6 py-2 rounded-lg"
              onClick={() => router.push("/")}
            >
              返回首页
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="h-16 w-16 mx-auto text-red-400 mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">验证失败</h1>
            <p className="text-sm text-zinc-400 mb-2">{message}</p>
            <p className="text-xs text-zinc-500 mb-6">
              如果已扣款，请稍后刷新页面或联系客服。
            </p>
            <button
              className="btn-primary px-6 py-2 rounded-lg"
              onClick={() => router.push("/")}
            >
              返回首页
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
