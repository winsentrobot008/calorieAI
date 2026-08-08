"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useTheme } from "@/components/theme-provider";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { Sun, Moon, Mic, X } from "lucide-react";
import { t, useLocale } from "@/lib/i18n";
import LocaleSwitcher from "@/components/locale-switcher";

// ─── Constants ────────────────────────────────────────────────────────
const API = "/api";
const MEAL_TYPES = [
  { value: "breakfast", labelKey: "meal_type_breakfast" },
  { value: "lunch", labelKey: "meal_type_lunch" },
  { value: "dinner", labelKey: "meal_type_dinner" },
  { value: "snack", labelKey: "meal_type_snack" },
];

const MOCK_FOODS = [
  { food: "白米饭", food_en: "White Rice", grams: 200, calories: 260, protein_g: 4, fat_g: 0.6, carbs_g: 58, confidence: 0.92 },
  { food: "鸡胸肉", food_en: "Chicken Breast", grams: 150, calories: 247, protein_g: 46, fat_g: 5.3, carbs_g: 0, confidence: 0.88 },
  { food: "西兰花", food_en: "Broccoli", grams: 100, calories: 34, protein_g: 2.8, fat_g: 0.4, carbs_g: 7, confidence: 0.95 },
];

const MOCK_STATS = { status: "ok", stats: { calories: 541, protein_g: 52.8, fat_g: 6.3, carbs_g: 65, meal_count: 3 }, goals: { daily_calories: 2000, daily_protein: 60, daily_fat: 65, daily_carbs: 300, goal_type: "maintain" } };
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

// 当前部署版本标识（CEO 在页脚/日志首行可直接核对线上版本）
const APP_VERSION = "v1.2.0 (A->B->C Vision Pipeline)";

// ─── Theme Toggle ──────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="rounded-full p-2 transition-colors hover:bg-zinc-700/50" aria-label={t("toggle_theme")}>
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
            <stop offset="0%" stopColor="#f59e0b" /><stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <text x="60" y="52" textAnchor="middle" fill="#f1f5f9" fontSize="22" fontWeight="700">{calories.toFixed(0)}</text>
        <text x="60" y="70" textAnchor="middle" fill="#64748b" fontSize="11">/ {target.toFixed(0)} kcal</text>
      </svg>
      {diff > 0 ? <span style={{ fontSize: 12, color: "#fbbf24", marginTop: 4 }}>{t("cal_over_target", { diff: diff.toFixed(0) })}</span>
        : <span style={{ fontSize: 12, color: "#34d399", marginTop: 4 }}>{t("cal_remaining", { diff: Math.abs(diff).toFixed(0) })}</span>}
    </div>
  );
}

// ─── Meal Distribution ─────────────────────────────────────────────────
function MealDistribution({ trendDays }: { trendDays: typeof MOCK_TREND_DAYS }) {
  if (!trendDays?.length) return null;
  const today = trendDays[trendDays.length - 1];
  const mt = today.meal_types;
  if (!mt) return null;
  const total = mt.breakfast + mt.lunch + mt.dinner + mt.snack;
  if (total === 0) return null;
  const items = [
    { label: t("meal_type_breakfast"), cal: mt.breakfast, color: "#f59e0b" },
    { label: t("meal_type_lunch"), cal: mt.lunch, color: "#34d399" },
    { label: t("meal_type_dinner"), cal: mt.dinner, color: "#60a5fa" },
    { label: t("meal_type_snack"), cal: mt.snack, color: "#a78bfa" },
  ].filter(i => i.cal > 0);
  if (!items.length) return null;
  const r = 40; const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="card-title">{t("today_meal_distribution")}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center" }}>
        <svg width="110" height="110" viewBox="0 0 100 100">
          {items.map((item, i) => {
            const pct = item.cal / total;
            const segLen = pct * circ; const gap = 2;
            const dashArray = `${segLen - gap} ${circ - segLen + gap}`;
            const seg = (<circle key={i} cx="50" cy="50" r={r} fill="none" stroke={item.color} strokeWidth="14"
              strokeDasharray={dashArray} strokeDashoffset={-offset} transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dashoffset .6s" }} />);
            offset += segLen; return seg;
          })}
          <text x="50" y="46" textAnchor="middle" fill="#f1f5f9" fontSize="16" fontWeight="700">{total.toFixed(0)}</text>
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
  if (!data.length) return null;
  return (
    <div className="card" style={{ position: "relative" }}>
      <div className="card-title">{t("calorie_trend")}</div>
      <div className="trend-toggle">
        <button className={`trend-btn ${period === "weekly" ? "active" : ""}`} onClick={() => setPeriod("weekly")}>{t("weekly")}</button>
        <button className={`trend-btn ${period === "monthly" ? "active" : ""}`} onClick={() => setPeriod("monthly")}>{t("monthly")}</button>
      </div>
      <div className="trend-container">
        <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart-svg" onMouseLeave={() => setTooltip(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
            const y = PAD_TOP + chartH * (1 - r);
            const val = Math.round(maxCal * r);
            return (<g key={i}><line x1={PAD_LEFT} y1={y} x2={W - PAD_RIGHT} y2={y} stroke="#1e293b" strokeWidth="1" /><text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fill="#64748b" fontSize="9">{val}</text></g>);
          })}
          {data[0]?.goal_calories > 0 && (<line x1={PAD_LEFT} y1={getY(data[0].goal_calories)} x2={W - PAD_RIGHT} y2={getY(data[0].goal_calories)} stroke="#f59e0b44" strokeWidth="1" strokeDasharray="4,3" />)}
          <path d={`M${getX(0)},${PAD_TOP + chartH} L${calPoints} L${getX(data.length - 1)},${PAD_TOP + chartH} Z`} fill="url(#trendGrad)" opacity="0.15" />
          <defs><linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" /><stop offset="100%" stopColor="#60a5fa00" /></linearGradient></defs>
          <polyline points={calPoints} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" />
          {data.map((d, i) => {
            const cx = getX(i); const cy = getY(d.calories);
            return (<circle key={i} cx={cx} cy={cy} r="3.5" fill="#60a5fa" stroke="#12141d" strokeWidth="1.5" style={{ cursor: "pointer" }} onMouseEnter={() => setTooltip({ x: cx, y: cy, data: d })} />);
          })}
          {data.map((d, i) => {
            const x = getX(i);
            const label = period === "weekly" ? (i === 0 ? t("days_ago_6") : i === data.length - 1 ? t("today") : d.weekday) : d.date.slice(5);
            if (period === "monthly" && i % 5 !== 0 && i !== data.length - 1) return null;
            return <text key={i} x={x} y={H - 4} textAnchor="middle" fill="#64748b" fontSize="8">{label}</text>;
          })}
        </svg>
        {tooltip && (
          <div className="trend-tooltip" style={{ left: Math.min(tooltip.x - 40, W - 120), top: Math.max(tooltip.y - 60, 0) }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{tooltip.data.calories} kcal</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{tooltip.data.date}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>P{tooltip.data.protein_g} · F{tooltip.data.fat_g} · C{tooltip.data.carbs_g}</div>
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // 仅做本地预览，不触发任何 AI API 请求（API 降本：禁用自动识图）
  const handleImageSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许同一文件被再次选择
    if (!file) return;

    const blobUrl = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreviewUrl(blobUrl);
    setResult(null);       // 显式清空旧识别结果（避免残存上次的 Mock/白米饭数据）
    setExpandedIdx(null);  // 同时收起上次展开的食物明细
    addLog(`[Upload] 已选择图片: ${file.name} (${(file.size / 1024).toFixed(1)} KB) — 仅预览，未触发 AI 请求`);
  };

  // 手动触发识图：仅在用户点击【开始 AI 识图】且已有预览图片时调用后端 AI 接口
  const handleAnalyze = async () => {
    if (!previewUrl || !selectedFile) return;
    setAnalyzing(true); setResult(null);
    addLog(`[AI] 开始识图: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`);

    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("meal_type", mealType);

      const res = await fetch(`${API}/v1/meals/analyze-image`, {
        method: "POST",
        body: fd,
      });

      if (res.ok) {
        const data = await res.json();
        setResult(data.records || []);
        // 日志面板直接打印命中模型名（例如 "Gemini (gemini-2.0-flash)"）
        const modelLabel = data.model?.label || (data.model ? `${data.model.provider} (${data.model.model || "unknown"})` : "");
        if (modelLabel) addLog(`[AI] 识别模型: ${modelLabel}`);
        addLog(`[AI] 识别到 ${data.count} 种食物`);
        data.records?.forEach((rec: any) => {
          addLog(`  ${rec.food} — ${rec.calories} kcal (P${rec.protein_g}/F${rec.fat_g}/C${rec.carbs_g})`);
        });
      } else {
        const err = await res.text();
        addLog(`[Error] ${err.slice(0, 100)}`);
      }
    } catch (err: any) {
      addLog(`[Error] ${err.message}`);
    }
    setAnalyzing(false);
  };

  const handleTextSubmit = async () => {
    if (!text.trim()) return;
    setAnalyzing(true); setResult(null);
    addLog(`[Text] 正在解析: "${text.slice(0, 50)}..."`);
    await new Promise(r => setTimeout(r, 1000));
    setResult(MOCK_FOODS);
    addLog("[AI] 解析到 3 种食物");
    setAnalyzing(false);
  };

  return (
    <div>
      <div className="card"><div className="card-title">{t("select_meal_type")}</div>
        <div className="meal-type-row">{MEAL_TYPES.map(mt => (<button key={mt.value} className={`meal-type-btn ${mealType === mt.value ? "active" : ""}`} onClick={() => setMealType(mt.value)}>{t(mt.labelKey)}</button>))}</div>
      </div>
      <div className="card"><div className="card-title">{t("select_input_mode")}</div>
        <div className="tab-bar" style={{ margin: 0 }}>
          <button className={`tab ${mode === "image" ? "active" : ""}`} onClick={() => setMode("image")}>{t("image_upload")}</button>
          <button className={`tab ${mode === "text" ? "active" : ""}`} onClick={() => setMode("text")}>{t("text_input")}</button>
        </div>
      </div>
      {previewUrl && (<div className="card"><div className="card-title">{t("image_preview")}</div>
        <img src={previewUrl} alt="food preview" className="preview-thumb" />
        <button className="submit-btn" style={{ marginTop: 10, width: "100%" }} disabled={!previewUrl || analyzing} onClick={handleAnalyze}>
          {analyzing ? <span className="spinner" /> : t("start_ai_recognition")}
        </button>
      </div>)}
      {mode === "image" && (<div className="card"><div className="card-title">{t("upload_food_photo")}</div><div className="upload-area">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleImageSelected} />
        <input ref={galleryRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageSelected} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <button className="upload-btn" onClick={() => cameraRef.current?.click()} disabled={analyzing}>{t("take_photo")}</button>
          <button className="upload-btn" onClick={() => galleryRef.current?.click()} disabled={analyzing}>{t("choose_from_gallery")}</button>
        </div>
      </div></div>)}
      {mode === "text" && (<div className="card"><div className="card-title">{t("describe_food")}</div>
        <textarea className="text-input" placeholder={t("text_input_placeholder")} value={text} onChange={e => setText(e.target.value)} />
        <button className="submit-btn" style={{ marginTop: 10 }} disabled={!text.trim() || analyzing} onClick={handleTextSubmit}>
          {analyzing ? <span className="spinner" /> : <><Mic className="h-4 w-4" /> {t("ai_estimate")}</>}
        </button>
      </div>)}
      {result && result.length > 0 && (<div className="card"><div className="card-title">{t("recognition_result")}</div>
        {result.map((rec, i) => (<div key={i}>
          <div className="food-item clickable" onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}>
            <div style={{ flex: 1 }}>
              <div className="food-name">{rec.food}</div>
              {rec.food_en && <div className="food-name-en">{rec.food_en}</div>}
              <div className="food-grams">{rec.grams}g</div>
              {rec.confidence != null && (<div className="confidence-row"><div className="confidence-bar-bg"><div className="confidence-bar-fill" style={{ width: `${Math.round(rec.confidence * 100)}%` }} /></div><span className="confidence-label">{Math.round(rec.confidence * 100)}%</span></div>)}
            </div>
            <div className="food-nutrition"><div className="food-cal">{rec.calories} kcal</div><div className="food-macro">P{rec.protein_g} · F{rec.fat_g} · C{rec.carbs_g}</div></div>
          </div>
          {expandedIdx === i && (<div className="food-detail"><div className="detail-grid">
            <div className="detail-item"><span className="detail-label">{t("detail_protein")}</span><span className="detail-value">{rec.protein_g}g</span></div>
            <div className="detail-item"><span className="detail-label">{t("detail_fat")}</span><span className="detail-value">{rec.fat_g}g</span></div>
            <div className="detail-item"><span className="detail-label">{t("detail_carbs")}</span><span className="detail-value">{rec.carbs_g}g</span></div>
            <div className="detail-item"><span className="detail-label">{t("detail_grams")}</span><span className="detail-value">{rec.grams}g</span></div>
          </div></div>)}
        </div>))}
        <div className="food-item" style={{ borderBottom: "none", marginTop: 4 }}>
          <div className="food-name">{t("total")}</div>
          <div className="food-nutrition">
            <div className="food-cal">{result.reduce((s, r) => s + r.calories, 0).toFixed(0)} kcal</div>
            <div className="food-macro">P{result.reduce((s, r) => s + r.protein_g, 0).toFixed(1)} · F{result.reduce((s, r) => s + r.fat_g, 0).toFixed(1)} · C{result.reduce((s, r) => s + r.carbs_g, 0).toFixed(1)}</div>
          </div>
        </div>
      </div>)}
    </div>
  );
}

// ─── Daily Dashboard ───────────────────────────────────────────────────
function DailyDashboard() {
  const s = MOCK_STATS.stats; const g = MOCK_STATS.goals;
  return (<div>
    <div className="card" style={{ padding: "10px 16px", textAlign: "center" }}><span style={{ fontSize: 12, color: "#64748b" }}>2026-07-24</span></div>
    <div className="card" style={{ display: "flex", justifyContent: "center" }}><CalCircle calories={s.calories} target={g.daily_calories || 2000} /></div>
    <div className="card"><div className="card-title">{t("nutrition_detail")}</div>
      <StatBar label={t("detail_protein")} current={s.protein_g} target={g.daily_protein || 60} unit="g" color="#34d399" />
      <StatBar label={t("detail_fat")} current={s.fat_g} target={g.daily_fat || 65} unit="g" color="#60a5fa" />
      <StatBar label={t("detail_carbs")} current={s.carbs_g} target={g.daily_carbs || 300} unit="g" color="#fbbf24" />
      {s.meal_count > 0 && <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "#64748b" }}>{t("total_meal_records", { count: s.meal_count })}</div>}
    </div>
    <MealDistribution trendDays={MOCK_TREND_DAYS} />
    <TrendChart />
    <div className="card"><div className="card-title">{t("ai_suggestions")}</div>
      {MOCK_SUGGESTIONS.map((sg, i) => (<div key={i} className="suggestion-card"><span className="suggestion-icon">{sg.icon}</span><div><div className="suggestion-title">{sg.title}</div><div className="suggestion-detail">{sg.detail}</div></div></div>))}
    </div>
  </div>);
}

// ─── Profile ───────────────────────────────────────────────────────────
function Profile({ addLog }: { addLog: (msg: string) => void }) {
  const [userId, setUserId] = useState("anonymous");
  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState("maintain");
  const [dailyCalories, setDailyCalories] = useState(2000);
  const [dailyProtein, setDailyProtein] = useState(60);
  const [dailyFat, setDailyFat] = useState(65);
  const [dailyCarbs, setDailyCarbs] = useState(300);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const uid = typeof window !== "undefined" ? localStorage.getItem("user_id") || "anonymous" : "anonymous";
    setUserId(uid);
    fetch(`${API}/v1/user/profile?user_id=${uid}`)
      .then(r => r.ok && r.json()).then(data => { if (data?.user) { const u = data.user; setName(u.name || ""); setGoalType(u.goal_type || "maintain"); setDailyCalories(u.daily_calories || 2000); setDailyProtein(u.daily_protein || 60); setDailyFat(u.daily_fat || 65); setDailyCarbs(u.daily_carbs || 300); } }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    await new Promise(r => setTimeout(r, 500));
    setSaved(true); addLog("[SUCCESS] 目标已保存");
    setTimeout(() => setSaved(false), 2000);
    setSaving(false);
  };

  return (<div>
    <div className="card"><div className="card-title">{t("user_info")}</div>
      <div className="form-group"><label className="form-label">{t("nickname")}</label><input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder={t("nickname_placeholder")} /></div>
      <div className="form-group"><label className="form-label">{t("user_id_label")}</label><input className="form-input" value={userId} disabled style={{ opacity: 0.6 }} /></div>
    </div>
    <div className="card"><div className="card-title">{t("daily_goals")}</div>
      <div className="form-group"><label className="form-label">{t("goal_type")}</label>
        <div className="goal-type-row">
          {[{ value: "lose", labelKey: "goal_lose" }, { value: "maintain", labelKey: "goal_maintain" }, { value: "gain", labelKey: "goal_gain" }].map(opt => (
            <button key={opt.value} className={`goal-btn ${goalType === opt.value ? "active" : ""}`} onClick={() => setGoalType(opt.value)}>{t(opt.labelKey)}</button>
          ))}
        </div>
      </div>
      <div className="form-group"><label className="form-label">{t("daily_calorie_target")}</label><input className="form-input" type="number" value={dailyCalories} onChange={e => setDailyCalories(Number(e.target.value))} min={500} max={10000} /></div>
      <div className="macro-grid">
        <div className="form-group"><label className="form-label" style={{ color: "#34d399" }}>{t("detail_protein")} (g)</label><input className="form-input" type="number" value={dailyProtein} onChange={e => setDailyProtein(Number(e.target.value))} min={0} /></div>
        <div className="form-group"><label className="form-label" style={{ color: "#60a5fa" }}>{t("detail_fat")} (g)</label><input className="form-input" type="number" value={dailyFat} onChange={e => setDailyFat(Number(e.target.value))} min={0} /></div>
        <div className="form-group"><label className="form-label" style={{ color: "#fbbf24" }}>{t("detail_carbs")} (g)</label><input className="form-input" type="number" value={dailyCarbs} onChange={e => setDailyCarbs(Number(e.target.value))} min={0} /></div>
      </div>
      <button className="submit-btn" onClick={handleSave} disabled={saving} style={{ marginTop: 12 }}>{saving ? <span className="spinner" /> : saved ? t("saved") : t("save_goal")}</button>
    </div>
  </div>);
}

// ─── Login Modal ───────────────────────────────────────────────────────
function LoginModal({ onClose, addLog }: { onClose: () => void; addLog: (msg: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  // Hydration 防护: 首次渲染固定与 SSR 一致, 挂载后再读取 localStorage, 避免 React #418
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("");
    await new Promise(r => setTimeout(r, 500));
    const userId = `user_${Date.now()}`;
    localStorage.setItem("user_id", userId);
    localStorage.setItem("user_email", email);
    addLog(`[AUTH] 登录成功: ${email}`);
    onClose();
    setLoading(false);
  };

  const handleAnonymous = () => {
    localStorage.setItem("user_id", `anon_${Date.now()}`);
    addLog("[AUTH] 游客模式继续");
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content login-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h2>{mode === "login" ? t("login_title") : t("login_register")}</h2><button className="modal-close" onClick={onClose}><X className="h-5 w-5" /></button></div>
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}
          {mode === "register" && (<div className="form-group"><label>{t("nickname")}</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t("nickname_placeholder")} className="form-input" /></div>)}
          <div className="form-group"><label>{t("login_email")}</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="your@email.com" className="form-input" /></div>
          <div className="form-group"><label>{t("login_password")}</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={4} placeholder="••••••" className="form-input" /></div>
          <button type="submit" className="btn-primary login-submit" disabled={loading}>{loading ? "..." : (mode === "login" ? t("login_title") : t("login_register"))}</button>
        </form>
        <div className="login-toggle"><button className="btn-link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? t("no_account_register") : t("have_account_login")}</button></div>
        <div className="login-anonymous"><p>{t("login_anonymous_hint")}</p><button className="btn-secondary login-anon-btn" onClick={handleAnonymous}>{t("login_continue_anon")}</button></div>
        {hydrated && localStorage.getItem("user_email") && (<div className="login-logout"><button className="btn-link logout-btn" onClick={() => { localStorage.removeItem("user_id"); localStorage.removeItem("user_email"); addLog("[AUTH] 已退出登录"); onClose(); }}>{t("logout")}</button></div>)}
      </div>
    </div>
  );
}

// ─── Billing Modal — Multi-Channel (Stripe 主 + PayPal 辅) ────────────
// 支持的支付方式: 国际信用卡 / 支付宝 / 微信支付 / PayPal
type PaymentMethodType = "card" | "alipay" | "wechat_pay" | "paypal";

const PAYMENT_METHODS: {
  id: PaymentMethodType;
  label: string;
  labelEn: string;
  icon: string;
  description: string;
  provider: "stripe" | "paypal";
}[] = [
  { id: "card",       label: "信用卡 / 借记卡", labelEn: "Credit / Debit Card", icon: "💳", description: "Visa · Mastercard · American Express · JCB · UnionPay", provider: "stripe" },
  { id: "alipay",     label: "支付宝",           labelEn: "Alipay",              icon: "🔵", description: "Alipay · 支付宝", provider: "stripe" },
  { id: "wechat_pay", label: "微信支付",         labelEn: "WeChat Pay",          icon: "🟢", description: "WeChat Pay · 微信支付", provider: "stripe" },
  { id: "paypal",     label: "PayPal",           labelEn: "PayPal",              icon: "🅿️", description: "PayPal 账户支付", provider: "paypal" },
];

function BillingModal({ onClose, addLog }: { onClose: () => void; addLog: (msg: string) => void }) {
  const [activeTab, setActiveTab] = useState("subscription");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [paypalKey, setPaypalKey] = useState(0);

  const paypalClientId =
    process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "demo";

  const isPaypalDemo = paypalClientId === "demo" || paypalClientId === "YOUR_PAYPAL_CLIENT_ID_HERE";

  // 获取当前用户信息
  const getUserId = () => typeof window !== "undefined" ? localStorage.getItem("user_id") || "anonymous" : "anonymous";
  const getUserEmail = () => typeof window !== "undefined" ? localStorage.getItem("user_email") || "" : "";

  // ── Select plan → reset payment method ──────────────
  const handleSelectPlan = (plan: string) => {
    setSelectedPlan(plan);
    setPaymentMethod(null);
    setMessage("");
    addLog(`[BILLING] 已选择方案: ${plan}`);
  };

  // ═══════════════════════════════════════════════════════
  //  STRIPE (信用卡 / 支付宝 / 微信支付)
  // ═══════════════════════════════════════════════════════
  const handleStripeCheckout = async () => {
    if (!selectedPlan || !paymentMethod) return;
    setLoading(true);
    setMessage("");
    addLog(`[Stripe] 正在创建 ${selectedPlan} 支付会话 (${paymentMethod})...`);

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: selectedPlan,
          payment_method: paymentMethod === "card" ? "card" : paymentMethod, // "alipay" | "wechat_pay"
          user_id: getUserId(),
          email: getUserEmail(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t("stripe_error_create"));
      }

      if (data.mock) {
        setMessage(`✅ 演示模式 — ${selectedPlan} 购买成功`);
        addLog(`[Stripe] 演示模式: ${selectedPlan} 购买成功`);
        setLoading(false);
        return;
      }

      addLog(`[Stripe] 正在跳转到支付页面...`);
      window.location.href = data.url;
    } catch (error: any) {
      const errMsg = error.message || t("billing_error_payment_failed");
      setMessage(`❌ ${errMsg}`);
      addLog(`[Stripe Error] ${errMsg}`);
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════
  //  PAYPAL (Secondary)
  // ═══════════════════════════════════════════════════════
  const createPayPalOrder = async (): Promise<string> => {
    if (!selectedPlan) throw new Error(t("billing_error_select_plan_first"));
    addLog(`[PayPal] 正在创建订单 (${selectedPlan})...`);
    const res = await fetch("/api/paypal/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: selectedPlan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("paypal_error_create"));
    if (data.mock) {
      addLog(`[PayPal] 演示模式: 订单 ${data.id} (模拟)`);
      return data.id;
    }
    addLog(`[PayPal] 订单已创建: ${data.id}`);
    return data.id;
  };

  const handlePayPalApprove = async (data: { orderID: string }) => {
    addLog(`[PayPal] 支付已批准，正在捕获订单 ${data.orderID}...`);
    try {
      const res = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: data.orderID }),
      });
      const capture = await res.json();
      if (!res.ok) throw new Error(capture.error || t("paypal_error_capture"));
      if (capture.mock) {
        addLog(`[PayPal] 演示模式: 捕获成功 (模拟)`);
        setMessage(`✅ 演示模式 — ${selectedPlan} 购买成功`);
        return;
      }
      if (capture.status === "COMPLETED") {
        addLog(`[PayPal] 支付成功! 订单 ${capture.id}, 金额 $${capture.amount?.value || "?"}`);

        // 通过订阅 API 激活用户权限
        const userId = localStorage.getItem("user_id") || `paypal_${data.orderID}`;
        const email = localStorage.getItem("user_email") || "";

        await fetch(`/api/v1/billing/subscribe?plan=${selectedPlan}&user_id=${encodeURIComponent(userId)}&email=${encodeURIComponent(email)}&provider=paypal&order_id=${data.orderID}`, {
          method: "POST",
        });

        setMessage(`✅ 支付成功! 感谢订阅 ${selectedPlan} 🎉`);
        addLog(`[PayPal] 订阅已激活: userId=${userId}, plan=${selectedPlan}`);
      } else {
        addLog(`[PayPal] 支付状态异常: ${capture.status}`);
        setMessage(`⚠️ 支付状态: ${capture.status}`);
      }
    } catch (error: any) {
      addLog(`[PayPal Error] ${error.message}`);
      setMessage(`❌ ${error.message}`);
    }
  };

  const handlePayPalError = (err: Record<string, unknown>) => {
    const errMsg = err?.message || t("paypal_error");
    addLog(`[PayPal Error] ${errMsg}`);
    setMessage(`❌ ${errMsg}`);
  };

  // ── Price config ────────────────────────────────────
  const plans = [
    { plan: "monthly", label: "月付", price: 9.99, popular: false },
    { plan: "yearly", label: "年付", price: 79.99, popular: true },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content billing-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t("billing_upgrade_pro")}</h2>
          <button className="modal-close" onClick={onClose}><X className="h-5 w-5" /></button>
        </div>
        <div className="billing-status-bar">
          <span className="badge badge-free">{t("billing_free_user")}</span>
        </div>
        {message && <div className="billing-message">{message}</div>}

        {/* ─── Tab: 订阅 / 买断 ─────────────────────────── */}
        <div className="billing-tabs">
          <button
            className={`billing-tab ${activeTab === "subscription" ? "active" : ""}`}
            onClick={() => { setActiveTab("subscription"); setSelectedPlan(null); setPaymentMethod(null); }}
          >
            {t("billing_subscription")}
          </button>
          <button
            className={`billing-tab ${activeTab === "license" ? "active" : ""}`}
            onClick={() => { setActiveTab("license"); setSelectedPlan(null); setPaymentMethod(null); }}
          >
            {t("billing_license")}
          </button>
        </div>

        {/* ─── Plan Cards ──────────────────────────────── */}
        {activeTab === "subscription" && (
          <div className="plan-grid">
            {plans.map((p) => (
              <div key={p.plan} className={`plan-card ${p.popular ? "popular" : ""} ${selectedPlan === p.plan ? "selected" : ""}`}>
                {p.popular && <div className="plan-badge">{t("billing_most_popular")}</div>}
                <div className="plan-name">{t(p.plan === "monthly" ? "billing_monthly" : "billing_yearly")}</div>
                <div className="plan-price">
                  <span className="price">${p.price}</span>
                  <span className="period">{t(p.plan === "monthly" ? "billing_period_month" : "billing_period_year")}</span>
                </div>
                {p.plan === "yearly" && <div className="plan-save">{t("billing_save_yearly")}</div>}
                <ul className="plan-features">
                  <li>{t("billing_features_unlimited")}</li><li>{t("billing_features_nutrition")}</li><li>{t("billing_features_trends")}</li><li>{t("billing_features_suggestions")}</li><li>{t("billing_features_noads")}</li>
                </ul>
                <button className="btn-primary plan-btn" onClick={() => handleSelectPlan(p.plan)}>
                  {t("billing_select_plan", { plan: t(p.plan === "monthly" ? "billing_monthly" : "billing_yearly") })}
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTab === "license" && (
          <div className="license-section">
            <div className={`plan-card permanent-card ${selectedPlan === "permanent" ? "selected" : ""}`}>
              <div className="plan-name">{t("billing_license")}</div>
              <div className="plan-price"><span className="price">$199</span><span className="period">{t("billing_one_time")}</span></div>
              <ul className="plan-features"><li>{t("billing_features_all")}</li><li>{t("billing_features_lifetime")}</li><li>{t("billing_features_noads")}</li><li>{t("billing_features_early_access")}</li><li>{t("billing_features_free_updates")}</li></ul>
              <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", margin: "4px 0 12px" }}>{t("billing_license_value")}</div>
              <button className="btn-primary plan-btn btn-license" onClick={() => handleSelectPlan("permanent")}>
                {t("billing_select_permanent")}
              </button>
            </div>
          </div>
        )}

        {/* ─── Payment Method Selection ────────────────── */}
        {selectedPlan && !paymentMethod && (
          <div className="payment-method-section" style={{ marginTop: 16 }}>
            <div className="section-label" style={{ textAlign: "center", fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
              {t("billing_payment_method")}
            </div>
            <div className="payment-method-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {/* 信用卡 - Stripe */}
              <button className="payment-method-btn" onClick={() => setPaymentMethod("card")}>
                <div className="pmt-icon">💳</div>
                <div className="pmt-name">{t("billing_pay_card")}</div>
                <div className="pmt-desc">{t("billing_pay_card_desc")}</div>
              </button>

              {/* 支付宝 - Stripe */}
              <button className="payment-method-btn pmt-alipay" onClick={() => setPaymentMethod("alipay")}>
                <div className="pmt-icon">🔵</div>
                <div className="pmt-name">{t("billing_pay_alipay")}</div>
                <div className="pmt-desc">{t("billing_pay_alipay_desc")}</div>
              </button>

              {/* 微信支付 - Stripe */}
              <button className="payment-method-btn pmt-wechat" onClick={() => setPaymentMethod("wechat_pay")}>
                <div className="pmt-icon">🟢</div>
                <div className="pmt-name">{t("billing_pay_wechat")}</div>
                <div className="pmt-desc">{t("billing_pay_wechat_desc")}</div>
              </button>

              {/* PayPal */}
              <button className="payment-method-btn" onClick={() => { setPaymentMethod("paypal"); setPaypalKey((k) => k + 1); }}>
                <div className="pmt-icon">🅿️</div>
                <div className="pmt-name">{t("billing_pay_paypal")}</div>
                <div className="pmt-desc">{t("billing_pay_paypal_desc")}</div>
              </button>
            </div>
          </div>
        )}

        {/* ─── Stripe Checkout Buttons ─────────────────── */}
        {selectedPlan && (paymentMethod === "card" || paymentMethod === "alipay" || paymentMethod === "wechat_pay") && (
          <div className="stripe-section" style={{ marginTop: 16 }}>
            <button
              className="btn-primary stripe-pay-btn"
              style={{ width: "100%", padding: "14px 0", fontSize: 15, height: "auto" }}
              onClick={handleStripeCheckout}
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span className="spinner" /> {t("billing_processing")}
                </span>
              ) : (
                <>
                  {paymentMethod === "card" && t("billing_pay_btn_card", { amount: `$${selectedPlan === "monthly" ? "9.99" : selectedPlan === "yearly" ? "79.99" : "199.00"}` })}
                  {paymentMethod === "alipay" && t("billing_pay_btn_alipay", { amount: `¥${selectedPlan === "monthly" ? (9.99 * 7.2).toFixed(0) : selectedPlan === "yearly" ? (79.99 * 7.2).toFixed(0) : (199 * 7.2).toFixed(0)}` })}
                  {paymentMethod === "wechat_pay" && t("billing_pay_btn_wechat", { amount: `¥${selectedPlan === "monthly" ? (9.99 * 7.2).toFixed(0) : selectedPlan === "yearly" ? (79.99 * 7.2).toFixed(0) : (199 * 7.2).toFixed(0)}` })}
                </>
              )}
            </button>
            <button
              className="btn-back"
              style={{ width: "100%", marginTop: 6, padding: "6px 0", fontSize: 11, color: "#64748b", background: "none", border: "none", cursor: "pointer" }}
              onClick={() => setPaymentMethod(null)}
            >
              {t("billing_back")}
            </button>
          </div>
        )}

        {/* ─── PayPal Buttons ──────────────────────────── */}
        {selectedPlan && paymentMethod === "paypal" && (
          <div className="paypal-section" style={{ marginTop: 16, padding: "0 4px" }}>
            {isPaypalDemo ? (
              <button
                className="btn-primary"
                style={{ width: "100%", padding: "12px 0", fontSize: 15 }}
                onClick={() => {
                  addLog(`[PayPal Demo] 模拟支付成功: ${selectedPlan}`);
                  setMessage(`✅ 演示模式 — ${selectedPlan} 购买成功`);
                }}
              >
                {t("billing_paypal_demo")}
              </button>
            ) : (
              <PayPalScriptProvider
                key={paypalKey}
                options={{ clientId: paypalClientId, currency: "USD", intent: "capture" }}
              >
                <PayPalButtons
                  style={{ layout: "vertical", color: "gold", shape: "rect", label: "pay" }}
                  createOrder={createPayPalOrder}
                  onApprove={handlePayPalApprove}
                  onError={handlePayPalError}
                />
              </PayPalScriptProvider>
            )}
            <button
              className="btn-back"
              style={{ width: "100%", marginTop: 6, padding: "6px 0", fontSize: 11, color: "#64748b", background: "none", border: "none", cursor: "pointer" }}
              onClick={() => setPaymentMethod(null)}
            >
              {t("billing_back")}
            </button>
          </div>
        )}

        <div className="billing-footer">
          <p>{t("billing_footer")}</p>
        </div>
      </div>
    </div>
  );
}

// ─── TTS Panel ─────────────────────────────────────────────────────────
function TTSPanel({ addLog }: { addLog: (msg: string) => void }) {
  const [text, setText] = useState("你好，欢迎使用 CalorieAI 智能卡路里助手！");
  const [playing, setPlaying] = useState(false);
  const handleSpeak = async () => {
    if (!text.trim()) return; setPlaying(true); addLog("[TTS] 正在合成语音...");
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.trim(), voice: "zh-CN-XiaoxiaoNeural" }) });
      if (!res.ok) throw new Error("TTS 请求失败");
      const blob = await res.blob(); const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { setPlaying(false); addLog("[TTS] 播放完成"); };
      addLog("[TTS] 正在播放..."); await audio.play();
    } catch { addLog("[TTS Error] 语音合成失败"); setPlaying(false); }
  };
  return (<div className="card"><div className="card-title">{t("tts_title")}</div>
    <textarea className="text-input" rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={t("tts_placeholder")} />
    <div style={{ marginTop: 10 }}><button className="submit-btn" disabled={!text.trim() || playing} onClick={handleSpeak} style={{ height: 38, fontSize: 12 }}>{playing ? <span className="spinner" /> : t("tts_speak")}</button></div>
  </div>);
}

// ─── Admin Login ───────────────────────────────────────────────────────
function AdminLoginPage({ onLogin }: { onLogin: (s: any) => void }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("");
    await new Promise(r => setTimeout(r, 500));
    if (username === "admin" && password === "admin123") {
      onLogin({ adminId: "admin_001", username: "admin", role: "superadmin" });
    } else { setError("用户名或密码错误"); }
    setLoading(false);
  };
  return (<div className="admin-login-wrapper"><div className="admin-login-card">
    <h2>{t("admin_title")}</h2><p className="admin-login-hint">{t("admin_default_hint")}</p>
    <form onSubmit={handleLogin}>
      <div className="form-group"><label className="form-label">{t("admin_username")}</label><input className="form-input" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" /></div>
      <div className="form-group"><label className="form-label">{t("admin_password")}</label><input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="admin123" /></div>
      {error && <p className="admin-login-error">{error}</p>}
      <button className="submit-btn" type="submit" disabled={loading}>{loading ? t("admin_logging_in") : t("login_title")}</button>
    </form>
  </div></div>);
}

// ─── Admin Dashboard ───────────────────────────────────────────────────
function AdminDashboardPage({ session, onLogout }: { session: any; onLogout: () => void }) {
  const [tab, setTab] = useState("overview");
  function TabContent() {
    if (tab === "overview") return (<div className="admin-overview-grid">
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #60a5fa" }}><div className="admin-stat-label">{t("admin_total_users")}</div><div className="admin-stat-value">128</div></div>
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #34d399" }}><div className="admin-stat-label">{t("admin_today_recognitions")}</div><div className="admin-stat-value">45</div><div className="admin-stat-sub">本周: 312</div></div>
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #fbbf24" }}><div className="admin-stat-label">{t("admin_active_subscriptions")}</div><div className="admin-stat-value">23</div><div className="admin-stat-sub">永久买断: 7</div></div>
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #a78bfa" }}><div className="admin-stat-label">{t("admin_model_calls")}</div><div className="admin-stat-value">892</div></div>
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #ef4444" }}><div className="admin-stat-label">{t("admin_error_rate")}</div><div className="admin-stat-value">1.2%</div><div className="admin-stat-sub">错误: 11</div></div>
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #f59e0b" }}><div className="admin-stat-label">{t("admin_total_revenue")}</div><div className="admin-stat-value">$4,599</div></div>
    </div>);
    if (tab === "users") return (<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>ID</th><th>名称</th><th>订阅</th><th>买断</th><th>状态</th></tr></thead><tbody><tr><td className="admin-cell-id">user_001...</td><td>Test User</td><td><span className="admin-status active">active</span></td><td>-</td><td>正常</td></tr></tbody></table></div>);
    if (tab === "revenue") return (<div><div className="admin-overview-grid">
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #f59e0b" }}><div className="admin-stat-label">{t("admin_total_revenue")}</div><div className="admin-stat-value">$4,599</div></div>
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #60a5fa" }}><div className="admin-stat-label">{t("admin_subscription_revenue")}</div><div className="admin-stat-value">$3,599</div></div>
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #a78bfa" }}><div className="admin-stat-label">{t("admin_license_revenue")}</div><div className="admin-stat-value">$1,000</div></div>
      <div className="admin-stat-card" style={{ borderLeft: "3px solid #34d399" }}><div className="admin-stat-label">{t("admin_invoices")}</div><div className="admin-stat-value">45</div></div>
    </div></div>);
    if (tab === "models") return (<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>模型</th><th>调用次数</th><th>错误</th><th>错误率</th><th>延迟</th></tr></thead><tbody>
      {[{ name: "gpt-4o", calls: 320, errors: 2, error_rate_pct: 0.6, avg_latency_ms: 1200 }, { name: "claude-3.5", calls: 280, errors: 4, error_rate_pct: 1.4, avg_latency_ms: 980 }].map(m => (
        <tr key={m.name}><td>{m.name}</td><td>{m.calls}</td><td style={{ color: m.errors > 0 ? "#ef4444" : "#34d399" }}>{m.errors}</td><td>{m.error_rate_pct}%</td><td>{m.avg_latency_ms}ms</td></tr>
      ))}
    </tbody></table></div>);
    if (tab === "config") return (<div><div className="admin-config-form"><h4>{t("admin_system_config")}</h4><div style={{ background: "#0b0d14", padding: 12, borderRadius: 8, fontSize: 12, color: "#94a3b8" }}>
      <div>ai_provider: gpt-4o</div><div>max_recognitions_per_day: 10</div>
    </div></div></div>);
    if (tab === "logs") return (<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>时间</th><th>管理员</th><th>操作</th></tr></thead><tbody>
      <tr><td style={{ fontSize: 11 }}>{new Date().toISOString().slice(0, 19)}</td><td>admin_001</td><td><span className="admin-action-tag">update_config</span></td></tr>
    </tbody></table></div>);
    return null;
  };
  return (<div className="admin-dashboard">
    <div className="admin-header"><h2>{t("admin_title")}</h2><div className="admin-header-right"><span className="admin-user">{session.username} ({session.role})</span><button className="admin-logout-btn" onClick={onLogout}>{t("admin_logout")}</button></div></div>
    <div className="admin-tabs">
      {[{ id: "overview", labelKey: "admin_tab_overview" }, { id: "users", labelKey: "admin_tab_users" }, { id: "revenue", labelKey: "admin_tab_revenue" }, { id: "models", labelKey: "admin_tab_models" }, { id: "config", labelKey: "admin_tab_config" }, { id: "logs", labelKey: "admin_tab_logs" }].map(tabItem => (
        <button key={tabItem.id} className={`admin-tab ${tab === tabItem.id ? "active" : ""}`} onClick={() => setTab(tabItem.id)}>{t(tabItem.labelKey)}</button>
      ))}
    </div>
    <div className="admin-content"><TabContent /></div>
  </div>);
}

// ─── Main Page ─────────────────────────────────────────────────────────
export default function Home() {
  // Re-render the whole tree on language switch so every t() call updates.
  useLocale();
  const [tab, setTab] = useState("record");
  const [logs, setLogs] = useState([`[System] CalorieAI 已就绪 · Version: ${APP_VERSION}`]);
  const [showLogin, setShowLogin] = useState(false);
  const [showBilling, setShowBilling] = useState(false);
  const [adminSession, setAdminSession] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  const addLog = useCallback((msg: string) => {
    const ts = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${msg}`;
    setLogs(prev => [...prev.slice(-99), ts]);
  }, []);

  // Handle admin login
  const handleAdminLogin = (s: any) => {
    sessionStorage.setItem("admin_session", JSON.stringify(s));
    setAdminSession(s);
  };
  const handleAdminLogout = () => {
    sessionStorage.removeItem("admin_session");
    setAdminSession(null);
  };

  // Check saved admin session
  useEffect(() => {
    const saved = sessionStorage.getItem("admin_session");
    if (saved) setAdminSession(JSON.parse(saved));
  }, []);

  // Hydration 防护: 首次渲染固定渲染 t("login_title") 与 SSR 一致,
  // 挂载后才读取 localStorage 中的 user_email, 避免 React #418 (DOM 文本不一致)。
  useEffect(() => {
    setMounted(true);
  }, []);

  // If admin is logged in, show admin dashboard
  if (adminSession) {
    return <AdminDashboardPage session={adminSession} onLogout={handleAdminLogout} />;
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo" onDoubleClick={() => setAdminSession({ pending: true })} style={{ cursor: "pointer" }}>CalorieAI</span>
          <span className="goal-badge">{t("goal_maintain_short")}</span>
        </div>
        <div className="header-right">
          <span className="daily-target">{t("daily_target_label", { calories: 2000 })}</span>
          <button className="btn-upgrade" onClick={() => setShowBilling(true)}>{t("pro_badge")}</button>
          <button className="btn-login" onClick={() => setShowLogin(true)}>
            {mounted ? localStorage.getItem("user_email")?.split("@")[0] || t("login_title") : t("login_title")}
          </button>
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </header>

      {/* Request admin pending if double-click triggered */}
      {adminSession?.pending && <AdminLoginPage onLogin={handleAdminLogin} />}

      {/* Tab Bar */}
      <nav className="tab-bar">
        <button className={`tab ${tab === "record" ? "active" : ""}`} onClick={() => setTab("record")}>{t("record_diet")}</button>
        <button className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>{t("daily_stats")}</button>
        <button className={`tab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>{t("profile")}</button>
        <button className={`tab ${tab === "tts" ? "active" : ""}`} onClick={() => setTab("tts")}>{t("nav_tts")}</button>
      </nav>

      {/* Content */}
      <main className="content">
        {tab === "record" && <MealRecorder addLog={addLog} />}
        {tab === "dashboard" && <DailyDashboard />}
        {tab === "profile" && <Profile addLog={addLog} />}
        {tab === "tts" && <TTSPanel addLog={addLog} />}
      </main>

      {/* Log Footer */}
      <footer className="footer">
        <div className="log-bar">
          <span className="log-label">{t("log_label")}</span>
          <div className="log-scroll">
            {logs.map((l, i) => (<div key={i} className="log-line">{l}</div>))}
          </div>
        </div>
        <div className="version-bar">Version: {APP_VERSION}</div>
      </footer>

      {/* Modals */}
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} addLog={addLog} />}
      {showBilling && <BillingModal onClose={() => setShowBilling(false)} addLog={addLog} />}
    </div>
  );
}
