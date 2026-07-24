"use client";

import { useState, useCallback, useRef } from "react";
import { useTheme } from "@/components/theme-provider";
import { Sun, Moon, Upload, Mic } from "lucide-react";

// ─── Mock API base ────────────────────────────────────────────────────
const API = "/api";

// ─── Constants ────────────────────────────────────────────────────────
const MEAL_TYPES = [
  { value: "breakfast", label: "早餐" },
  { value: "lunch", label: "午餐" },
  { value: "dinner", label: "晚餐" },
  { value: "snack", label: "加餐" },
];

const MOCK_FOODS = [
  { food: "白米饭", food_en: "White Rice", grams: 200, calories: 260, protein_g: 4, fat_g: 0.6, carbs_g: 58, confidence: 0.92 },
  { food: "鸡胸肉", food_en: "Chicken Breast", grams: 150, calories: 247, protein_g: 46, fat_g: 5.3, carbs_g: 0, confidence: 0.88 },
  { food: "西兰花", food_en: "Broccoli", grams: 100, calories: 34, protein_g: 2.8, fat_g: 0.4, carbs_g: 7, confidence: 0.95 },
];

const MOCK_STATS = {
  status: "ok",
  stats: { calories: 541, protein_g: 52.8, fat_g: 6.3, carbs_g: 65, meal_count: 3 },
  goals: { daily_calories: 2000, daily_protein: 60, daily_fat: 65, daily_carbs: 300, goal_type: "maintain" },
};

const MOCK_SUGGESTIONS = [
  { icon: "🥗", title: "增加蔬菜摄入", detail: "今日蔬菜摄入偏少，建议晚餐补充一份绿叶蔬菜。" },
  { icon: "💧", title: "记得补充水分", detail: "当前饮水 1.2L，建议每日达到 2L。" },
];

const MOCK_TREND_DAYS = [
  { date: "2026-07-18", calories: 1820, protein_g: 65, fat_g: 55, carbs_g: 220, goal_calories: 2000, weekday: "周六", meal_types: { breakfast: 420, lunch: 680, dinner: 720, snack: 0 } },
  { date: "2026-07-19", calories: 1950, protein_g: 70, fat_g: 60, carbs_g: 240, goal_calories: 2000, weekday: "周日", meal_types: { breakfast: 380, lunch: 750, dinner: 820, snack: 0 } },
  { date: "2026-07-20", calories: 1680, protein_g: 55, fat_g: 45, carbs_g: 200, goal_calories: 2000, weekday: "周一", meal_types: { breakfast: 350, lunch: 620, dinner: 710, snack: 0 } },
  { date: "2026-07-21", calories: 2100, protein_g: 75, fat_g: 70, carbs_g: 260, goal_calories: 2000, weekday: "周二", meal_types: { breakfast: 450, lunch: 800, dinner: 850, snack: 0 } },
  { date: "2026-07-22", calories: 1780, protein_g: 60, fat_g: 50, carbs_g: 215, goal_calories: 2000, weekday: "周三", meal_types: { breakfast: 400, lunch: 650, dinner: 730, snack: 0 } },
  { date: "2026-07-23", calories: 1920, protein_g: 68, fat_g: 58, carbs_g: 235, goal_calories: 2000, weekday: "周四", meal_types: { breakfast: 380, lunch: 720, dinner: 820, snack: 0 } },
  { date: "2026-07-24", calories: 541, protein_g: 52.8, fat_g: 6.3, carbs_g: 65, goal_calories: 2000, weekday: "今天", meal_types: { breakfast: 260, lunch: 281, dinner: 0, snack: 0 } },
];

// ─── Theme Toggle ──────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="rounded-full p-2 transition-colors hover:bg-zinc-700/50" aria-label="切换主题">
      {theme === "dark" ? <Sun className="h-4 w-4 text-yellow-400" /> : <Moon className="h-4 w-4 text-zinc-400" />}
    </button>
  );
}

// ─── Stat Bar ──────────────────────────────────────────────────────────
function StatBar({ label, current, target, unit, color }: { label: string; current: number; target: number; unit: string; color: string }) {
  const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const diff = current - target;
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <div className="stat-bar-bg">
        <div className="stat-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="stat-value" style={{ color: diff > 0 ? "#fbbf24" : "#94a3b8" }}>
        {current.toFixed(0)}/{target.toFixed(0)} {unit}
      </span>
    </div>
  );
}

// ─── Calorie Ring ──────────────────────────────────────────────────────
function CalCircle({ calories, target }: { calories: number; target: number }) {
  const pct = target > 0 ? Math.min((calories / target) * 100, 100) : 0;
  const r = 54; const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const diff = calories - target;
  return (
    <div className="cal-ring-container">
      <svg width="140" height="140" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1e293b" strokeWidth="8" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="url(#calGrad)" strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 60 60)" style={{ transition: "stroke-dashoffset .8s" }} />
        <defs>
          <linearGradient id="calGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <text x="60" y="52" textAnchor="middle" fill="#f1f5f9" fontSize="22" fontWeight="700">
          {calories.toFixed(0)}
        </text>
        <text x="60" y="70" textAnchor="middle" fill="#64748b" fontSize="11">
          / {target.toFixed(0)} kcal
        </text>
      </svg>
      {diff > 0 ? (
        <span style={{ fontSize: 12, color: "#fbbf24", marginTop: 4 }}>超标 {diff.toFixed(0)} kcal</span>
      ) : (
        <span style={{ fontSize: 12, color: "#34d399", marginTop: 4 }}>还可摄入 {Math.abs(diff).toFixed(0)} kcal</span>
      )}
    </div>
  );
}

// ─── Meal Distribution ─────────────────────────────────────────────────
function MealDistribution({ trendDays }: { trendDays: typeof MOCK_TREND_DAYS }) {
  if (!trendDays || trendDays.length === 0) return null;
  const today = trendDays[trendDays.length - 1];
  const mt = today.meal_types;
  if (!mt) return null;
  const total = mt.breakfast + mt.lunch + mt.dinner + mt.snack;
  if (total === 0) return null;
  const items = [
    { label: "早餐", cal: mt.breakfast, color: "#f59e0b" },
    { label: "午餐", cal: mt.lunch, color: "#34d399" },
    { label: "晚餐", cal: mt.dinner, color: "#60a5fa" },
    { label: "加餐", cal: mt.snack, color: "#a78bfa" },
  ].filter(i => i.cal > 0);
  if (items.length === 0) return null;
  const r = 40; const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="card-title">今日饮食分布</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center" }}>
        <svg width="110" height="110" viewBox="0 0 100 100">
          {items.map((item, i) => {
            const pct = item.cal / total;
            const segLen = pct * circ;
            const gap = 2;
            const dashArray = `${segLen - gap} ${circ - segLen + gap}`;
            const seg = (
              <circle key={i} cx="50" cy="50" r={r} fill="none"
                stroke={item.color} strokeWidth="14"
                strokeDasharray={dashArray} strokeDashoffset={-offset}
                transform="rotate(-90 50 50)"
                style={{ transition: "stroke-dashoffset .6s" }}
              />
            );
            offset += segLen;
            return seg;
          })}
          <text x="50" y="46" textAnchor="middle" fill="#f1f5f9" fontSize="16" fontWeight="700">
            {total.toFixed(0)}
          </text>
          <text x="50" y="60" textAnchor="middle" fill="#64748b" fontSize="8">kcal</text>
        </svg>
        <div className="dist-legend">
          {items.map((item, i) => (
            <div key={i} className="dist-item">
              <span className="dist-dot" style={{ background: item.color }} />
              <span className="dist-label">{item.label}</span>
              <span className="dist-value">{item.cal.toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Trend Chart ───────────────────────────────────────────────────────
function TrendChart() {
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: typeof MOCK_TREND_DAYS[0] } | null>(null);
  const data = MOCK_TREND_DAYS;
  const W = 400, H = 180, PAD_TOP = 20, PAD_RIGHT = 16, PAD_BOTTOM = 28, PAD_LEFT = 44;
  const maxCal = Math.max(...data.map(d => d.calories || 0), 100);
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOTTOM;
  const stepX = chartW / Math.max(data.length - 1, 1);
  const getX = (i: number) => PAD_LEFT + i * stepX;
  const getY = (v: number) => PAD_TOP + chartH - (v / maxCal) * chartH;
  const calPoints = data.map((d, i) => `${getX(i)},${getY(d.calories)}`).join(" ");
  const goalY = getY(data[0]?.goal_calories || 2000);

  return (
    <div className="card" style={{ position: "relative" }}>
      <div className="card-title">卡路里趋势</div>
      <div className="trend-toggle">
        <button className={`trend-btn ${period === "weekly" ? "active" : ""}`} onClick={() => setPeriod("weekly")}>本周</button>
        <button className={`trend-btn ${period === "monthly" ? "active" : ""}`} onClick={() => setPeriod("monthly")}>本月</button>
      </div>
      <div className="trend-container">
        <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart-svg" onMouseLeave={() => setTooltip(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
            const y = PAD_TOP + chartH * (1 - r);
            const val = Math.round(maxCal * r);
            return (
              <g key={i}>
                <line x1={PAD_LEFT} y1={y} x2={W - PAD_RIGHT} y2={y} stroke="#1e293b" strokeWidth="1" />
                <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fill="#64748b" fontSize="9">{val}</text>
              </g>
            );
          })}
          {data[0]?.goal_calories > 0 && (
            <line x1={PAD_LEFT} y1={goalY} x2={W - PAD_RIGHT} y2={goalY}
              stroke="#f59e0b44" strokeWidth="1" strokeDasharray="4,3" />
          )}
          <path d={`M${getX(0)},${PAD_TOP + chartH} L${calPoints} L${getX(data.length - 1)},${PAD_TOP + chartH} Z`}
            fill="url(#trendGrad)" opacity="0.15" />
          <defs>
            <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#60a5fa00" />
            </linearGradient>
          </defs>
          <polyline points={calPoints} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" />
          {data.map((d, i) => {
            const cx = getX(i); const cy = getY(d.calories);
            return (
              <circle key={i} cx={cx} cy={cy} r="3.5" fill="#60a5fa" stroke="#12141d" strokeWidth="1.5"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setTooltip({ x: cx, y: cy, data: d })}
              />
            );
          })}
          {data.map((d, i) => {
            const x = getX(i);
            const label = period === "weekly"
              ? (i === 0 ? "6天前" : i === data.length - 1 ? "今天" : d.weekday)
              : d.date.slice(5);
            if (period === "monthly" && i % 5 !== 0 && i !== data.length - 1) return null;
            return <text key={i} x={x} y={H - 4} textAnchor="middle" fill="#64748b" fontSize="8">{label}</text>;
          })}
        </svg>
        {tooltip && (
          <div className="trend-tooltip"
            style={{ left: Math.min(tooltip.x - 40, W - 120), top: Math.max(tooltip.y - 60, 0) }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{tooltip.data.calories} kcal</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{tooltip.data.date}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>
              P{tooltip.data.protein_g} &middot; F{tooltip.data.fat_g} &middot; C{tooltip.data.carbs_g}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Meal Recorder ─────────────────────────────────────────────────────
function MealRecorder({ addLog }: { addLog: (msg: string) => void }) {
  const [mealType, setMealType] = useState("breakfast");
  const [mode, setMode] = useState<"image" | "text">("image");
  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<typeof MOCK_FOODS | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async () => {
    setAnalyzing(true);
    setResult(null);
    addLog("[Upload] 正在识别图片...");
    await new Promise(r => setTimeout(r, 1200));
    setResult(MOCK_FOODS);
    MOCK_FOODS.forEach(rec => addLog(`  ${rec.food} — ${rec.calories} kcal (P${rec.protein_g}/F${rec.fat_g}/C${rec.carbs_g})`));
    addLog("[AI] 识别到 3 种食物");
    setAnalyzing(false);
  };

  const handleTextSubmit = async () => {
    if (!text.trim()) return;
    setAnalyzing(true);
    setResult(null);
    addLog(`[Text] 正在解析: "${text.slice(0, 50)}..."`);
    await new Promise(r => setTimeout(r, 1000));
    setResult(MOCK_FOODS);
    addLog("[AI] 解析到 3 种食物");
    setAnalyzing(false);
  };

  return (
    <div>
      <div className="card">
        <div className="card-title">选择餐次</div>
        <div className="meal-type-row">
          {MEAL_TYPES.map(mt => (
            <button key={mt.value} className={`meal-type-btn ${mealType === mt.value ? "active" : ""}`}
              onClick={() => setMealType(mt.value)}>{mt.label}</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-title">选择输入方式</div>
        <div className="tab-bar" style={{ margin: 0 }}>
          <button className={`tab ${mode === "image" ? "active" : ""}`} onClick={() => setMode("image")}>拍照/上传</button>
          <button className={`tab ${mode === "text" ? "active" : ""}`} onClick={() => setMode("text")}>文字输入</button>
        </div>
      </div>
      {mode === "image" && (
        <div className="card">
          <div className="card-title">上传食物照片</div>
          <div className="upload-area">
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageUpload} />
            <button className="upload-btn" onClick={() => { fileRef.current?.click(); handleImageUpload(); }} disabled={analyzing}>
              {analyzing ? <span className="spinner" /> : <><Upload className="h-4 w-4" /> 拍照或选择图片</>}
            </button>
          </div>
        </div>
      )}
      {mode === "text" && (
        <div className="card">
          <div className="card-title">描述你吃了什么</div>
          <textarea className="text-input" placeholder="例如：中午吃了一碗米饭 + 一块鸡胸肉 + 一盘西兰花"
            value={text} onChange={e => setText(e.target.value)} />
          <button className="submit-btn" style={{ marginTop: 10 }}
            disabled={!text.trim() || analyzing} onClick={handleTextSubmit}>
            {analyzing ? <span className="spinner" /> : <><Mic className="h-4 w-4" /> AI 估算卡路里</>}
          </button>
        </div>
      )}
      {result && result.length > 0 && (
        <div className="card">
          <div className="card-title">识别结果</div>
          {result.map((rec, i) => (
            <div key={i}>
              <div className="food-item clickable" onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}>
                <div style={{ flex: 1 }}>
                  <div className="food-name">{rec.food}</div>
                  {rec.food_en && <div className="food-name-en">{rec.food_en}</div>}
                  <div className="food-grams">{rec.grams}g</div>
                  {rec.confidence != null && (
                    <div className="confidence-row">
                      <div className="confidence-bar-bg">
                        <div className="confidence-bar-fill" style={{ width: `${Math.round(rec.confidence * 100)}%` }} />
                      </div>
                      <span className="confidence-label">{Math.round(rec.confidence * 100)}%</span>
                    </div>
                  )}
                </div>
                <div className="food-nutrition">
                  <div className="food-cal">{rec.calories} kcal</div>
                  <div className="food-macro">P{rec.protein_g} &middot; F{rec.fat_g} &middot; C{rec.carbs_g}</div>
                </div>
              </div>
              {expandedIdx === i && (
                <div className="food-detail">
                  <div className="detail-grid">
                    <div className="detail-item"><span className="detail-label">蛋白质</span><span className="detail-value">{rec.protein_g}g</span></div>
                    <div className="detail-item"><span className="detail-label">脂肪</span><span className="detail-value">{rec.fat_g}g</span></div>
                    <div className="detail-item"><span className="detail-label">碳水</span><span className="detail-value">{rec.carbs_g}g</span></div>
                    <div className="detail-item"><span className="detail-label">份量</span><span className="detail-value">{rec.grams}g</span></div>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div className="food-item" style={{ borderBottom: "none", marginTop: 4 }}>
            <div className="food-name">总计</div>
            <div className="food-nutrition">
              <div className="food-cal">{result.reduce((s, r) => s + r.calories, 0).toFixed(0)} kcal</div>
              <div className="food-macro">
                P{result.reduce((s, r) => s + r.protein_g, 0).toFixed(1)} &middot;
                F{result.reduce((s, r) => s + r.fat_g, 0).toFixed(1)} &middot;
                C{result.reduce((s, r) => s + r.carbs_g, 0).toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Daily Dashboard ───────────────────────────────────────────────────
function DailyDashboard() {
  const stats = MOCK_STATS;
  const s = stats.stats;
  const g = stats.goals;

  if (!stats || stats.status !== "ok") {
    return (
      <div className="card" style={{ textAlign: "center", padding: 40 }}>
        <span style={{ fontSize: 40 }}>📊</span>
        <p style={{ marginTop: 12, color: "#64748b", fontSize: 13 }}>还没有饮食记录，先去记录一餐吧！</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ padding: "10px 16px", textAlign: "center" }}>
        <span style={{ fontSize: 12, color: "#64748b" }}>2026-07-24</span>
      </div>
      <div className="card" style={{ display: "flex", justifyContent: "center" }}>
        <CalCircle calories={s.calories} target={g.daily_calories || 2000} />
      </div>
      <div className="card">
        <div className="card-title">营养明细</div>
        <StatBar label="蛋白质" current={s.protein_g} target={g.daily_protein || 60} unit="g" color="#34d399" />
        <StatBar label="脂肪" current={s.fat_g} target={g.daily_fat || 65} unit="g" color="#60a5fa" />
        <StatBar label="碳水" current={s.carbs_g} target={g.daily_carbs || 300} unit="g" color="#fbbf24" />
        {s.meal_count > 0 && (
          <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "#64748b" }}>
            共 {s.meal_count} 条饮食记录
          </div>
        )}
      </div>
      <MealDistribution trendDays={MOCK_TREND_DAYS} />
      <TrendChart />
      <div className="card">
        <div className="card-title">AI 饮食建议</div>
        {MOCK_SUGGESTIONS.map((sg, i) => (
          <div key={i} className="suggestion-card">
            <span className="suggestion-icon">{sg.icon}</span>
            <div>
              <div className="suggestion-title">{sg.title}</div>
              <div className="suggestion-detail">{sg.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Profile ───────────────────────────────────────────────────────────
function Profile() {
  return (
    <div className="card" style={{ textAlign: "center", padding: 32 }}>
      <span style={{ fontSize: 48 }}>👤</span>
      <p style={{ marginTop: 12, color: "#64748b", fontSize: 13 }}>个人设置页面（开发中）</p>
    </div>
  );
}

// ─── TTS Panel ─────────────────────────────────────────────────────────
function TTSPanel({ addLog }: { addLog: (msg: string) => void }) {
  const [text, setText] = useState("你好，欢迎使用 CalorieAI 智能卡路里助手！");
  const [playing, setPlaying] = useState(false);

  const handleSpeak = async () => {
    if (!text.trim()) return;
    setPlaying(true);
    addLog(`[TTS] 正在合成语音...`);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), voice: "zh-CN-XiaoxiaoNeural" }),
      });
      if (!res.ok) throw new Error("TTS 请求失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { setPlaying(false); addLog(`[TTS] 播放完成`); };
      addLog(`[TTS] 正在播放...`);
      await audio.play();
    } catch (err) {
      console.error(err);
      addLog(`[TTS Error] 语音合成失败`);
      setPlaying(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">🔊 Edge-TTS 语音测试</div>
      <textarea className="text-input" rows={2}
        value={text} onChange={e => setText(e.target.value)}
        placeholder="输入要朗读的文本..." />
      <div style={{ marginTop: 10 }}>
        <button className="submit-btn" disabled={!text.trim() || playing} onClick={handleSpeak}
          style={{ height: 38, fontSize: 12 }}>
          {playing ? <span className="spinner" /> : "🔊 朗读"}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState("record");
  const [logs, setLogs] = useState(["[System] CalorieAI 已就绪"]);
  const today = new Date().toISOString().slice(0, 10);

  const addLog = useCallback((msg: string) => {
    const t = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${msg}`;
    setLogs(prev => [...prev.slice(-99), t]);
  }, []);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo">CalorieAI</span>
          <span className="goal-badge">维持体重</span>
        </div>
        <div className="header-right">
          <span className="daily-target">目标 2000 kcal</span>
          <ThemeToggle />
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="tab-bar">
        <button className={`tab ${tab === "record" ? "active" : ""}`} onClick={() => setTab("record")}>
          记录饮食
        </button>
        <button className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
          数据看板
        </button>
        <button className={`tab ${tab === "tts" ? "active" : ""}`} onClick={() => setTab("tts")}>
          TTS 测试
        </button>
      </nav>

      {/* Content */}
      <main className="content">
        {tab === "record" && <MealRecorder addLog={addLog} />}
        {tab === "dashboard" && <DailyDashboard />}
        {tab === "tts" && <TTSPanel addLog={addLog} />}
      </main>

      {/* Log Footer */}
      <footer className="footer">
        <div className="log-bar">
          <span className="log-label">📋 日志</span>
          <div className="log-scroll">
            {logs.map((l, i) => (
              <div key={i} className="log-line">{l}</div>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
