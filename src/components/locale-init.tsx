"use client";

import { useEffect } from "react";
import { applyResolvedLocale } from "@/lib/i18n";

/**
 * 客户端挂载后应用首选语言 (localStorage 手动设置 > navigator.language > 默认 en)。
 *
 * 放在 layout 的客户端子树中, 避免在 hydration 阶段就改变文本导致 React #418
 * (服务端用默认语言渲染, 客户端挂载后再切换到真实语言)。
 */
export default function LocaleInit() {
  useEffect(() => {
    applyResolvedLocale();
  }, []);
  return null;
}
