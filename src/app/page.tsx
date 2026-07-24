"use client";

import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import {
  Sun,
  Moon,
  Apple,
  Flame,
  Dumbbell,
  Droplets,
  Play,
  Square,
  Volume2,
  Loader2,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

// ─── Mock data ────────────────────────────────────────────────────────
const NUTRITION_STATS = [
  { label: "今日卡路里", value: "1,842", unit: "kcal", icon: Flame, color: "text-orange-500", trend: "up", change: "+12%" },
  { label: "蛋白质", value: "98", unit: "g", icon: Dumbbell, color: "text-red-500", trend: "up", change: "+5%" },
  { label: "碳水化合物", value: "186", unit: "g", icon: Apple, color: "text-yellow-500", trend: "down", change: "-3%" },
  { label: "水分", value: "1.2", unit: "L", icon: Droplets, color: "text-blue-500", trend: "up", change: "+8%" },
];

const HISTORY_DATA = [
  { date: "2026-07-24", meal: "早餐", calories: 420, protein: 18, carbs: 52, fat: 14 },
  { date: "2026-07-24", meal: "午餐", calories: 680, protein: 35, carbs: 72, fat: 22 },
  { date: "2026-07-24", meal: "晚餐", calories: 742, protein: 45, carbs: 62, fat: 28 },
  { date: "2026-07-23", meal: "早餐", calories: 380, protein: 15, carbs: 48, fat: 12 },
  { date: "2026-07-23", meal: "午餐", calories: 720, protein: 38, carbs: 68, fat: 24 },
  { date: "2026-07-23", meal: "晚餐", calories: 655, protein: 40, carbs: 58, fat: 20 },
];

const DAILY_TARGET = 2000;

// ─── Components ───────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="rounded-full p-2 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700"
      aria-label={theme === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
    >
      {theme === "dark" ? <Sun className="h-5 w-5 text-yellow-400" /> : <Moon className="h-5 w-5 text-zinc-600" />}
    </button>
  );
}

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  color,
  trend,
  change,
}: (typeof NUTRITION_STATS)[number]) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800/60">
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${color} bg-zinc-100 dark:bg-zinc-700/50`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="flex-1">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</span>
          <span className="text-sm text-zinc-400">{unit}</span>
        </div>
      </div>
      <div className={`flex items-center gap-1 text-sm font-medium ${trend === "up" ? "text-green-500" : "text-red-500"}`}>
        {trend === "up" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        {change}
      </div>
    </div>
  );
}

function CalorieProgressBar({ current, target }: { current: number; target: number }) {
  const pct = Math.min((current / target) * 100, 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">今日进度</span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {current.toLocaleString()} / {target.toLocaleString()} kcal
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function HistoryTable({ data }: { data: typeof HISTORY_DATA }) {
  const [expanded, setExpanded] = useState(false);
  const displayed = expanded ? data : data.slice(0, 3);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-800/60">
      <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">饮食记录</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              <th className="pb-2 font-medium">日期</th>
              <th className="pb-2 font-medium">餐次</th>
              <th className="pb-2 font-medium text-right">卡路里</th>
              <th className="pb-2 font-medium text-right hidden sm:table-cell">蛋白质</th>
              <th className="pb-2 font-medium text-right hidden sm:table-cell">碳水</th>
              <th className="pb-2 font-medium text-right hidden sm:table-cell">脂肪</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((row, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-700/50">
                <td className="py-3 text-zinc-700 dark:text-zinc-300">{row.date}</td>
                <td className="py-3 text-zinc-700 dark:text-zinc-300">{row.meal}</td>
                <td className="py-3 text-right font-medium text-orange-600 dark:text-orange-400">{row.calories}</td>
                <td className="py-3 text-right text-zinc-600 dark:text-zinc-400 hidden sm:table-cell">{row.protein}g</td>
                <td className="py-3 text-right text-zinc-600 dark:text-zinc-400 hidden sm:table-cell">{row.carbs}g</td>
                <td className="py-3 text-right text-zinc-600 dark:text-zinc-400 hidden sm:table-cell">{row.fat}g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 flex w-full items-center justify-center gap-1 text-sm text-blue-500 transition-colors hover:text-blue-600"
        >
          {expanded ? (
            <>收起 <ChevronUp className="h-4 w-4" /></>
          ) : (
            <>展开全部 ({data.length} 条) <ChevronDown className="h-4 w-4" /></>
          )}
        </button>
      )}
    </div>
  );
}

function TTSTestBox() {
  const [text, setText] = useState("你好，欢迎使用 CalorieAI 智能卡路里助手！");
  const [playing, setPlaying] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const handleSpeak = async () => {
    if (!text.trim()) return;
    setPlaying(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice: "zh-CN-XiaoxiaoNeural" }),
      });
      if (!res.ok) throw new Error("TTS 请求失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      const audio = new Audio(url);
      audio.onended = () => setPlaying(false);
      await audio.play();
    } catch (err) {
      console.error(err);
      alert("语音合成失败，请检查控制台错误信息。");
      setPlaying(false);
    }
  };

  const handleStop = () => {
    setPlaying(false);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-800/60">
      <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        <Volume2 className="h-5 w-5 text-blue-500" />
        Edge-TTS 语音测试
      </h3>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full resize-none rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-800 placeholder-zinc-400 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/30"
        placeholder="输入要朗读的文本..."
      />
      <div className="mt-3 flex items-center gap-3">
        {!playing ? (
          <button
            onClick={handleSpeak}
            disabled={!text.trim()}
            className="flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            朗读
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="flex items-center gap-2 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
          >
            <Square className="h-4 w-4" />
            停止
          </button>
        )}
        {playing && <Loader2 className="h-5 w-5 animate-spin text-blue-500" />}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function Home() {
  const currentCalories = HISTORY_DATA.filter((r) => r.date === "2026-07-24").reduce((sum, r) => sum + r.calories, 0);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-green-400 to-emerald-600 text-white shadow-sm">
              <Flame className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              Calorie<span className="text-emerald-500">AI</span>
            </h1>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NUTRITION_STATS.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>

        {/* Progress Bar */}
        <CalorieProgressBar current={currentCalories} target={DAILY_TARGET} />

        {/* Two-column layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <HistoryTable data={HISTORY_DATA} />
          <TTSTestBox />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 py-6 text-center text-sm text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
        CalorieAI &copy; {new Date().getFullYear()} &mdash; 基于 Next.js + Edge-TTS
      </footer>
    </div>
  );
}
