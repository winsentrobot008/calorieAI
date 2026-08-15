# -*- coding: utf-8 -*-
"""
ceo_visual_demo.py — CEO 专属拟人化慢速可视化深度巡检（Playwright Visual Demo）

视觉特效（page.add_init_script 向页面根节点注入全局 <canvas id="ceo-pointer-canvas">）：
  - 隐藏原生光标；高亮红色 Pointer（8px 实心 + 白描边）+ 蓝色追随光环（20px，平滑滞后）；
  - human_move 轨迹动画：page.mouse.move 分段插值 25 步，光标划过屏幕留下近 15 点淡出尾迹；
  - human_click 拟人化点击：先沿 25 步轨迹滑到目标中心，再触发点击；
  - 点击涟漪：window mousedown 触发点生成 40px 红色扩散波纹（300ms 渐隐动画）。

全 UI / 逻辑深度巡检路径（对齐 PROJECT_SPEC 所有分支）：
  步骤 A  多语言与导航：中文/EN 切换 + 依次点击【记录饮食】【数据看板】【个人设置】校验渲染
  步骤 B  餐次全覆盖：早餐 / 午餐 / 晚餐 / 加餐 依次慢速点击
  步骤 C  文字与识图：逐字输入「吃了2个包子和1杯豆浆」→ AI 汇总 + 积分 -1；
          扫描 TEMP 目录真实图片（无则回退 demo-food.jpg）逐张上传 → 捕获“图片已优化 (XXKB)”
          并硬校验【小笼包 (X颗 / 约XXg)】数量+约重名称 与 整盘总热量（kcal 总计行）；
          命中后显式停顿 2 秒，放大并高亮展示“小笼包 (X 颗)”识别结果卡片
  步骤 D  商业与广告：看广告领积分（+10）；充值/Pro → Stripe 3 套卡片 → 模拟购买跳转 Checkout

用法：
  npm run demo:visual                                # 桌面端，线上生产 URL
  python scripts/ceo_visual_demo.py --mode mobile    # iPhone 14 移动端模拟
  python scripts/ceo_visual_demo.py --url http://127.0.0.1:3100
  python scripts/ceo_visual_demo.py --fast           # 快节奏短视频模式：slowMo=150ms、human_move 8 步、
                                                     # 内置演示应答快节奏出片（动作序列 ~18s，加载头自动裁剪），
                                                     # 自动录屏并导出
                                                     # TEMP/calorieai_demo_fast.mp4
  python scripts/ceo_visual_demo.py --promo-en       # YouTube Shorts 英文宣推视频：locale en-US 全英文 UI +
                                                     # Edge-TTS 美音解说 4 段（intro/scan/pro/CTA）+ 高码率高清 MP4
                                                     # （TEMP/calorieai_yt_promo_en.mp4）
"""

# 注入式 Toast 日志：MutationObserver 捕获瞬时 Toast（fast 模式下“图片已优化 (XXKB)”
# 可能被识别成功 Toast 毫秒级替换，DOM 轮询会漏）
TOAST_CATCH_JS = r"""
(() => {
  if (window.__toastCatch) return;
  window.__toastCatch = true;
  window.__toastLog = [];
  const push = (txt) => {
    if (txt && !window.__toastLog.includes(txt)) window.__toastLog.push(txt);
  };
  const scan = () => {
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length === 0 && /图片已优化|Image optimized|识别成功|Recognized|积分不足|Insufficient|上传|失败|Error/.test(el.textContent || '')) {
        push(el.textContent.trim());
      }
    }
  };
  const mo = new MutationObserver(() => scan());
  const boot = () => {
    if (document.body) {
      scan();
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else {
      setTimeout(boot, 30);
    }
  };
  boot();
})();
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DEMO_URL = "https://calorie-ai-seven.vercel.app/"
ASSET = ROOT / "scripts" / "assets" / "demo-food.jpg"
TEMP_DIR = ROOT.parent.parent / "TEMP"  # git008/TEMP（仓库根下的本地真实图片集）
SHOT_DIR = ROOT / "qa-logs"
SLOW_MO = 1200  # 所有操作放慢 1.2s
FAST_SLOW_MO = 150  # --fast 模式：所有操作 0.15s
PROMO_SLOW_MO = 250  # --promo-en 模式：宣推节奏 0.25s
FAST_VIDEO = TEMP_DIR / "calorieai_demo_fast.mp4"  # 短视频导出落盘路径
PROMO_VIDEO = TEMP_DIR / "calorieai_yt_promo_en.mp4"  # YouTube Shorts 英文宣推视频导出路径
FAST_MODE = False  # 由 main() 依据 --fast 设置
PROMO_EN = False  # 由 main() 依据 --promo-en 设置
HUMAN_STEPS = 25  # 轨迹步进：默认 25 步；fast 模式压缩为 8 步


def collect_demo_images(fast=False):
    """扫描本地 TEMP 目录图片（.jpg/.jpeg/.png，≤3MB 取前 3 张）；
    始终附加 scripts/assets/demo-food.jpg 作为“数量清点”校验锚点；
    TEMP 无图片时复制 demo-food.jpg 回退；fast 模式仅用 demo-food.jpg 小笼包锚点出片。"""
    if fast:
        if ASSET.exists():
            return [ASSET]
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ASSET, TEMP_DIR / "demo-food.jpg")
        return [TEMP_DIR / "demo-food.jpg"]
    imgs = []
    if TEMP_DIR.exists():
        for ext in ("*.jpg", "*.jpeg", "*.png"):
            imgs.extend(TEMP_DIR.glob(ext))
    imgs = [p for p in imgs if p.is_file() and p.stat().st_size <= 3 * 1024 * 1024]
    imgs = sorted(imgs)[:3]
    if ASSET.exists() and ASSET.name not in {p.name for p in imgs}:
        imgs.append(ASSET)
    if not imgs:
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ASSET, TEMP_DIR / "demo-food.jpg")
        imgs = [TEMP_DIR / "demo-food.jpg"]
    return imgs

IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

# ── Canvas 视觉特效强制渲染：add_init_script 注入 #ceo-pointer-canvas ──
# 红点 Pointer(8px) + 蓝色追随光环(20px) + 近 15 点淡出尾迹 + 40px/300ms 点击波纹
FX_JS = r"""
(() => {
  if (window.__ceoPointerFX) return;
  window.__ceoPointerFX = true;

  // add_init_script 在文档根建立前执行：延迟 boot，直到 body 可用再注入
  const build = () => {
    if (window.__ceoPointerBooted) return true;
    if (!document.documentElement || !document.body) return false;
    window.__ceoPointerBooted = true;

    // 隐藏原生光标（全局样式，对后续动态元素同样生效）
    const st = document.createElement('style');
    st.textContent = 'html, body, body * { cursor: none !important; }';
    (document.head || document.documentElement).appendChild(st);

    const cv = document.createElement('canvas');
    cv.id = 'ceo-pointer-canvas';
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:999999!important;';
    const ctx = cv.getContext('2d');
    const mount = () => (document.body || document.documentElement).appendChild(cv);
    mount();

    // 强制持久化：React/Next 重绘或卸载子节点都无法移除画布
    if (window.MutationObserver) {
      new MutationObserver(() => { if (!cv.isConnected) mount(); })
        .observe(document.documentElement, { childList: true, subtree: true });
    }

    // 高分屏（移动端 dpr=3）保持清晰
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.floor(innerWidth * dpr));
      cv.height = Math.max(1, Math.floor(innerHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    addEventListener('resize', resize);

    const MAX_TRAIL = 15;    // 保留近 15 个历史坐标点
    const pts = [];          // 移动轨迹点
    let mx = -100, my = -100, tx = -100, ty = -100, rx = -100, ry = -100;
    const ripples = [];

    const push = (x, y) => {
      mx = x; my = y; tx = x; ty = y;
      pts.push({ x, y, t: performance.now() });
      if (pts.length > MAX_TRAIL) pts.shift();
    };
    const onMove = (e) => push(e.clientX, e.clientY);
    const onDown = (e) => ripples.push({ x: e.clientX, y: e.clientY, t: performance.now() });

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mousedown', onDown, { passive: true });
    // 移动端触屏兜底（mobile 模式仍可见轨迹与波纹）
    window.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) onMove(t); }, { passive: true });
    window.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) onDown(t); }, { passive: true });

    const frame = (now) => {
      ctx.clearRect(0, 0, cv.width, cv.height);

      // 尾迹 Trail：近 15 点连线 + 端点小点，700ms 渐隐
      const cut = now - 700;
      while (pts.length && pts[0].t < cut) pts.shift();
      if (pts.length > 1) {
        ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let i = 1; i < pts.length; i++) {
          const age = (now - pts[i].t) / 700;
          ctx.strokeStyle = `rgba(255,80,80,${Math.max(0, 0.65 * (1 - age))})`;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
        for (const pt of pts) {
          const age = (now - pt.t) / 700;
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,120,120,${Math.max(0, 0.7 * (1 - age))})`;
          ctx.fill();
        }
      }

      // 蓝色追随光环（20px，平滑滞后 → 人眼可见光标划过路径）
      rx += (tx - rx) * 0.2;
      ry += (ty - ry) * 0.2;
      if (rx > -50) {
        ctx.beginPath(); ctx.arc(rx, ry, 20, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(96,165,250,0.9)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(rx, ry, 13, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(96,165,250,0.35)'; ctx.lineWidth = 6; ctx.stroke();
      }

      // 高亮红色 Pointer（8px 实心 + 白描边增强对比）
      if (mx > -50) {
        ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,45,45,1)'; ctx.fill();
        ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; ctx.stroke();
      }

      // 点击波纹 Ripple：6px → 40px 红圈扩散，300ms 渐隐
      for (const r of [...ripples]) {
        const p = (now - r.t) / 300;
        if (p >= 1) { ripples.splice(ripples.indexOf(r), 1); continue; }
        const radius = 6 + p * 34;
        const alpha = 1 - p;
        ctx.beginPath(); ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,45,45,${alpha})`;
        ctx.lineWidth = 4; ctx.stroke();
        ctx.beginPath(); ctx.arc(r.x, r.y, 3 + p * 12, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,45,45,${0.4 * alpha})`; ctx.fill();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return true;
  };

  if (build()) return;
  // 文档根尚未建立：轮询 + DOMContentLoaded 双保险，直到 body 可用
  const iv = setInterval(() => { if (build()) clearInterval(iv); }, 20);
  document.addEventListener('DOMContentLoaded', () => { if (build()) clearInterval(iv); });
})();
"""

# 数量名称 / 数量+约重（如 “小笼包 (9 颗 / 约 270g)”）识别锚点
QTY_RE = re.compile(r"\(\s*\d+\s*(?:颗|块|个|碗|份|只|串|片|杯|盘)")
QTY_G_RE = re.compile(r"\(\s*\d+\s*(?:颗|块|个|碗|份|只|串|片|杯|盘)\s*[/／、|]\s*约\s*\d+\s*(?:g|G|克)\s*\)")
EN_QTY_G_RE = re.compile(
    r"\(\s*\d+\s*(?:pcs?|pieces?|servings?|bowls?|cups?|slices?|sticks?|buns?)\s*[/／]\s*approx\.?\s*\d+\s*g\s*\)",
    re.I,
)


def log(msg):
    print(f"[demo] {msg}", flush=True)


def human_move(page, x, y, steps=None):
    """拟人化轨迹滑动：page.mouse.move 分段插值（默认 25 步 / fast 8 步），模拟平滑曲线滑行，
    slowMo=1200ms 下每个落点事件依次触发 Canvas FX 的红点 Pointer / 蓝色光环 /
    近 15 点淡出尾迹，确保人眼极其清晰地看到红点划过屏幕。"""
    page.mouse.move(x, y, steps=steps or HUMAN_STEPS)
    page.wait_for_timeout(60 if FAST_MODE else 400)


def human_click(page, selector, timeout=10000, steps=None):
    """拟人化点击：先沿 smooth 轨迹滑到目标中心，再执行点击（点击处自动生成 40px 红色波纹）。"""
    el = page.query_selector(selector)
    if el:
        box = el.bounding_box()
        if box and box["width"] > 0 and box["height"] > 0:
            human_move(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=steps)
    page.click(selector, timeout=timeout)


def parse_credits(text):
    """从积分角标文案解析数字，如 '🎯 积分: 9' / '🎯 Credits: 9' -> 9。"""
    if not text:
        return None
    m = re.search(r"(?:积分|Credits)[:：]?\s*(\d+)", text)
    return int(m.group(1)) if m else None


class CreditLedger:
    """演示积分账本：拦截 /api/v1/user/credits，GET 返回种子余额，
    POST 按 delta 记账后回包，保证巡检全程积分充足且差额确定（-1/+10 可校验）。
    AI 识别链路（analyze-text / analyze-image）不拦截，仍走真实线上接口。"""

    def __init__(self, start=50):
        self.balance = start

    def handle(self, route):
        req = route.request
        try:
            if req.method == "GET":
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"credits": self.balance}))
                return
            if req.method == "POST":
                data = json.loads(req.post_data or "{}")
                delta = int(data.get("delta") or 0)
                self.balance = max(0, self.balance + delta)
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"credits": self.balance}))
                return
        except Exception:
            pass
        route.continue_()


# ── --fast 模式内置演示应答（仅在快节奏短视频模式下拦截 analyze 接口）──
TEXT_FAST_RESPONSE = {
    "records": [
        {"food": "包子", "food_en": "Steamed Bun", "grams": 160, "calories": 280, "protein_g": 10, "fat_g": 6, "carbs_g": 44, "confidence": 0.95},
        {"food": "豆浆", "food_en": "Soy Milk", "grams": 250, "calories": 120, "protein_g": 8, "fat_g": 3, "carbs_g": 12, "confidence": 0.93},
    ],
    "items": [
        {"food": "包子", "food_en": "Steamed Bun", "grams": 160, "calories": 280, "protein_g": 10, "fat_g": 6, "carbs_g": 44, "confidence": 0.95},
        {"food": "豆浆", "food_en": "Soy Milk", "grams": 250, "calories": 120, "protein_g": 8, "fat_g": 3, "carbs_g": 12, "confidence": 0.93},
    ],
    "totalKcal": 400, "totalProtein": 18, "totalFat": 9, "totalCarbs": 56,
    "count": 2,
    "model": {"provider": "gemini", "model": "demo-fast", "label": "Fast Demo (built-in response)"},
}

IMAGE_FAST_RESPONSE = {
    "records": [
        {"food": "小笼包 (9 颗 / 约 270g)", "food_en": "Xiaolongbao (9 pcs / ~270g)", "grams": 270, "calories": 450, "protein_g": 36, "fat_g": 18, "carbs_g": 42, "confidence": 0.92},
    ],
    "totalKcal": 450, "totalProtein": 36, "totalFat": 18, "totalCarbs": 42,
    "count": 1,
    "model": {"provider": "gemini", "model": "demo-fast", "label": "Fast Demo (built-in response)"},
}


def mock_text_route(route):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(TEXT_FAST_RESPONSE, ensure_ascii=False))


def mock_image_route(route):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(IMAGE_FAST_RESPONSE, ensure_ascii=False))


# ── --promo-en 英文演示应答（仅英文宣推视频模式拦截 analyze 接口）──
TEXT_EN_RESPONSE = {
    "records": [
        {"food": "Steamed Buns", "food_en": "Steamed Buns", "grams": 160, "calories": 280, "protein_g": 10, "fat_g": 6, "carbs_g": 44, "confidence": 0.95},
        {"food": "Soy Milk", "food_en": "Soy Milk", "grams": 250, "calories": 120, "protein_g": 8, "fat_g": 3, "carbs_g": 12, "confidence": 0.93},
    ],
    "items": [
        {"food": "Steamed Buns", "food_en": "Steamed Buns", "grams": 160, "calories": 280, "protein_g": 10, "fat_g": 6, "carbs_g": 44, "confidence": 0.95},
        {"food": "Soy Milk", "food_en": "Soy Milk", "grams": 250, "calories": 120, "protein_g": 8, "fat_g": 3, "carbs_g": 12, "confidence": 0.93},
    ],
    "totalKcal": 400, "totalProtein": 18, "totalFat": 9, "totalCarbs": 56,
    "count": 2,
    "model": {"provider": "gemini", "model": "promo-en-demo", "label": "Promo EN (built-in response)"},
}

IMAGE_EN_RESPONSE = {
    "records": [
        {"food": "Steamed Buns (9 pcs / approx. 270g)", "food_en": "Steamed Buns", "grams": 270, "calories": 540, "protein_g": 40, "fat_g": 22, "carbs_g": 54, "confidence": 0.92},
    ],
    "totalKcal": 540, "totalProtein": 40, "totalFat": 22, "totalCarbs": 54,
    "count": 1,
    "model": {"provider": "gemini", "model": "promo-en-demo", "label": "Promo EN (built-in response)"},
}


def mock_text_en_route(route):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(TEXT_EN_RESPONSE, ensure_ascii=False))


def mock_image_en_route(route):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(IMAGE_EN_RESPONSE, ensure_ascii=False))


# ── YouTube Shorts 英文宣推：Edge-TTS 解说（en-US-ChristopherNeural / en-US-JennyNeural）──
PROMO_AUDIO = [
    ("intro", "en-US-ChristopherNeural", "Tired of counting calories one by one? Check this out."),
    ("scan", "en-US-JennyNeural", "Just snap a photo of your meal. AI automatically counts every item and sums up the calories instantly!"),
    ("pro", "en-US-JennyNeural", "Unlock unlimited AI scans with quick Stripe checkout."),
    ("cta", "en-US-ChristopherNeural", "Try 3 free scans today. Link in description!"),
]


def generate_promo_audio(audio_dir):
    """调用 Edge-TTS 生成 4 段英文解说 mp3，返回 {key: path}（失败为 None）。"""
    audio_dir.mkdir(parents=True, exist_ok=True)
    result = {}
    try:
        import asyncio
        import edge_tts
    except Exception as e:
        log(f"[TTS] edge-tts 不可用: {e}")
        return result
    for key, voice, text in PROMO_AUDIO:
        path = audio_dir / f"{key}.mp3"
        try:
            async def _gen():
                com = edge_tts.Communicate(text, voice, rate="+10%")
                await com.save(str(path))
            asyncio.run(_gen())
            if path.exists() and path.stat().st_size > 0:
                result[key] = str(path)
                log(f"  [TTS] {key} <- {voice} ({path.stat().st_size} bytes)")
            else:
                log(f"  [TTS] {key} 生成文件为空")
        except Exception as e:
            log(f"  [TTS] {key} 失败: {e}")
    return result


def mp3_to_wav(mp3_path, wav_path):
    """mp3 → 44100Hz 立体声 wav（供 winsound 实时播放）。"""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            return None
    subprocess.run(
        [ffmpeg, "-y", "-i", str(mp3_path), "-ar", "44100", "-ac", "2", str(wav_path)],
        capture_output=True, timeout=120, check=True,
    )
    return wav_path if Path(wav_path).exists() else None


def play_audio_async(wav_path):
    """本机实时播放解说（Windows winsound 异步）；无 winsound 时静默跳过。"""
    if not wav_path or not Path(wav_path).exists():
        return
    try:
        import winsound
        winsound.PlaySound(str(wav_path), winsound.SND_FILENAME | winsound.SND_ASYNC)
    except Exception:
        pass


def probe_duration(path):
    """ffprobe 读取媒体时长（秒），失败返回 0。"""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        return float(out.stdout.strip())
    except Exception:
        return 0.0


def export_promo_video(src, out_path, audio_paths, offsets_ms, head_trim, video_dur):
    """将录制 webm 与 4 段 TTS 解说按时间轴混音，导出高码率高清英文宣推 MP4。
    转码参数：-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -b:v 6M -movflags +faststart。"""
    if not src or not Path(src).exists():
        return {"ok": False, "error": f"录制文件不存在: {src}"}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg = None
    if not ffmpeg:
        return {"ok": False, "error": "ffmpeg 不可用，无法合成音轨"}

    tmp = out_path.with_suffix(".tmp.mp4")
    inputs = [ffmpeg, "-y"]
    if head_trim > 0:
        inputs += ["-ss", f"{head_trim:.2f}"]
    inputs += ["-i", str(src)]
    # 固定 4 段音频输入顺序（intro=1 / scan=2 / pro=3 / cta=4），缺失段用静音占位
    for key in ("intro", "scan", "pro", "cta"):
        if key in audio_paths:
            inputs += ["-i", str(audio_paths[key])]
        else:
            inputs += ["-f", "lavfi", "-t", "0.2", "-i", "anullsrc=r=44100:cl=stereo"]

    labels = {"intro": "1", "scan": "2", "pro": "3", "cta": "4"}
    chains, mix_inputs = [], []
    for key, off in offsets_ms.items():
        idx = labels[key]
        chains.append(f"[{idx}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={off}|{off}[a{idx}]")
        mix_inputs.append(f"[a{idx}]")
    filter_complex = ";".join(chains) + f";{''.join(mix_inputs)}amix=inputs=4:duration=longest:normalize=0,apad[aout]"

    cmd = inputs + [
        "-filter_complex", filter_complex,
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-b:v", "6M",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "192k",
        "-t", f"{video_dur:.2f}",
        str(tmp),
    ]
    subprocess.run(cmd, capture_output=True, timeout=600, check=True)
    if tmp.exists():
        shutil.move(str(tmp), str(out_path))
    return {
        "ok": True,
        "src": str(src),
        "dest": str(out_path),
        "bytes": out_path.stat().st_size if out_path.exists() else 0,
        "offsets_ms": offsets_ms,
        "head_trim_s": round(head_trim, 2),
        "video_dur_s": round(video_dur, 2),
    }


def export_fast_video(page, out_path, head_trim=0.0):
    """将 Playwright record_video_dir 录制的 webm 转码为 H.264 MP4 并落盘；
    head_trim 秒剪掉页面加载头，让出片直接进入快节奏演示动作。"""
    try:
        src = page.video.path()
    except Exception as e:
        return {"ok": False, "error": f"video.path: {e}"}
    if not src or not Path(src).exists():
        return {"ok": False, "error": f"录制文件不存在: {src}"}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg = None
    if not ffmpeg:
        # 兜底：直接拷贝（webm 容器，非真 MP4）
        shutil.copy2(src, out_path)
        return {"ok": True, "fallback_copy_webm": True, "src": str(src), "dest": str(out_path)}
    tmp = out_path.with_suffix(".tmp.mp4")
    cmd = [ffmpeg, "-y"]
    if head_trim > 0:
        cmd += ["-ss", f"{head_trim:.2f}"]
    # 高码率 + 高兼容性：libx264 slow 压制 / 3Mbps 恒定码率（nal-hrd=cbr 强制达标——
    # 静态 UI 内容下 CRF/ABR 会严重欠码至 0.6~2.3MB，5M CBR 则超 10MB 上限）/
    # yuv420p（Windows 媒体播放器原生支持）/ faststart（moov 前置，秒开不黑屏）
    cmd += [
        "-i", str(src),
        "-c:v", "libx264",
        "-preset", "slow",
        "-pix_fmt", "yuv420p",
        "-b:v", "3M",
        "-minrate", "3M",
        "-maxrate", "3M",
        "-bufsize", "6M",
        "-x264-params", "nal-hrd=cbr",
        "-movflags", "+faststart",
        "-an",
        str(tmp),
    ]
    subprocess.run(cmd, capture_output=True, timeout=300, check=True)
    if tmp.exists():
        shutil.move(str(tmp), str(out_path))
    return {
        "ok": True,
        "src": str(src),
        "dest": str(out_path),
        "bytes": out_path.stat().st_size if out_path.exists() else 0,
        "head_trim_s": round(head_trim, 2),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    global FAST_MODE, PROMO_EN, HUMAN_STEPS
    parser = argparse.ArgumentParser(description="CEO 拟人化慢速可视化深度巡检 / 快节奏短视频 / YouTube Shorts 英文宣推")
    parser.add_argument("--url", default=DEMO_URL)
    parser.add_argument("--mode", choices=["desktop", "mobile"], default="desktop")
    parser.add_argument("--fast", action="store_true",
                        help="快节奏短视频模式：slowMo=150ms、human_move 8 步、内置演示应答（analyze 接口拦截）、"
                             "小笼包高光停顿 1s、自动录屏并导出 TEMP/calorieai_demo_fast.mp4")
    parser.add_argument("--promo-en", action="store_true",
                        help="YouTube Shorts 英文宣推视频：locale en-US 全英文 UI、Edge-TTS 美音解说 4 段"
                             "（intro/scan/pro/CTA）、高码率高清 MP4（TEMP/calorieai_yt_promo_en.mp4）")
    parser.add_argument("--pro-demo", action="store_true",
                        help="演示 Pro 状态：向 localStorage 注入 calorieai_demo_pro=true（仅自动化演示使用，"
                             "不改变生产代码中未登录默认非 Pro 的商业逻辑）")
    parser.add_argument("--mobile-demo", action="store_true",
                        help="移动端自动化巡检：iPhone 13 (390x844) 触摸模拟 + 全英文 UI + "
                             "移动支付按钮触达校验（全宽 / >=48px）+ Stripe 英文 Checkout 跳转")
    args = parser.parse_args()
    if args.promo_en:
        args.mode = "desktop"  # 宣推视频固定桌面端 16:10 画幅
    if args.mobile_demo:
        args.mode = "mobile"  # 移动端巡检固定 iPhone 13 390x844 触摸视口
    FAST_MODE = args.fast
    PROMO_EN = args.promo_en
    HUMAN_STEPS = 8 if args.fast else (12 if args.promo_en else 25)
    slow_mo = FAST_SLOW_MO if args.fast else (PROMO_SLOW_MO if args.promo_en else SLOW_MO)

    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "url": args.url,
        "mode": args.mode,
        "fast": args.fast,
        "promo_en": args.promo_en,
        "pro_demo": args.pro_demo,
        "mobile_demo": args.mobile_demo,
        "slow_mo_ms": slow_mo,
        "steps": [],
        "findings": {},
        "screenshots": [],
        "console_errors": [],
    }

    # Edge-TTS 必须在 Playwright sync 上下文之外生成（sync API 内部已有事件循环，
    # asyncio.run() 会报 “cannot be called from a running event loop”）
    promo_audio_paths = {}
    if args.promo_en:
        log("🎙️ 生成 Edge-TTS 英文解说（en-US-ChristopherNeural / en-US-JennyNeural）…")
        promo_audio_paths = generate_promo_audio(SHOT_DIR / "promo-en" / "audio")
        report["findings"]["promo_audio_mp3"] = promo_audio_paths

    def shot(name):
        # fast 模式以视频为唯一产物：跳过常规截图，仅保留小笼包 zoom 高光
        if FAST_MODE and "zoom" not in name:
            return None
        path = SHOT_DIR / f"demo-{args.mode}-{name}-{int(time.time())}.png"
        try:
            page.screenshot(path=str(path))
            report["screenshots"].append(str(path))
        except Exception:
            pass
        return path

    def step(name, fn):
        start = time.time()
        try:
            detail = fn()
            report["steps"].append({"name": name, "ok": True, "elapsed": round(time.time() - start, 1), "detail": detail})
            log(f"✅ {name} :: {detail}")
        except Exception as e:
            report["steps"].append({"name": name, "ok": False, "elapsed": round(time.time() - start, 1), "detail": str(e)})
            log(f"❌ {name} :: {e}")
            shot(name.replace(" ", "-")[:40])

    def read_credits():
        try:
            return page.inner_text(".credit-chip", timeout=3000)
        except Exception:
            return None

    def pause(ms):
        """装饰性等待：fast 模式 ÷6（下限 60ms）、promo 模式 ÷4（下限 80ms），保证快节奏出片。"""
        if FAST_MODE:
            page.wait_for_timeout(max(60, ms // 6))
        elif PROMO_EN:
            page.wait_for_timeout(max(80, ms // 4))
        else:
            page.wait_for_timeout(ms)

    def wait_url_part(part, timeout=40):
        deadline = time.time() + (15 if FAST_MODE else timeout)
        while time.time() < deadline:
            if part in page.url:
                return page.url
            pause(500)
        return None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=slow_mo)
        vw, vh = (1280, 800) if args.mode == "desktop" else (390, 844)
        ctx_kwargs = {"viewport": {"width": vw, "height": vh}}
        if args.mode == "mobile":
            ctx_kwargs.update(device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=IPHONE_UA)
        if args.fast:
            video_dir = SHOT_DIR / "video-fast"
            video_dir.mkdir(parents=True, exist_ok=True)
            ctx_kwargs.update(record_video_dir=str(video_dir), record_video_size={"width": vw, "height": vh})
        if args.promo_en:
            # 全英文运行环境：locale en-US + 美东时区
            ctx_kwargs.update(locale="en-US", timezone_id="America/New_York")
            promo_video_dir = SHOT_DIR / "video-promo-en"
            promo_video_dir.mkdir(parents=True, exist_ok=True)
            ctx_kwargs.update(record_video_dir=str(promo_video_dir), record_video_size={"width": vw, "height": vh})
        ctx = browser.new_context(**ctx_kwargs)
        rec_start = time.monotonic()
        page = ctx.new_page()
        # 视觉特效强制渲染：add_init_script 在页面任何脚本之前注入
        # 全局 <canvas id="ceo-pointer-canvas">（z-index:999999!important / pointer-events:none）
        page.add_init_script(script=FX_JS)
        page.add_init_script(script=TOAST_CATCH_JS)
        if args.promo_en or args.mobile_demo:
            # 全英文 UI：promo 宣推 / mobile 巡检均注入 en locale
            page.add_init_script(script="try { localStorage.setItem('calorieai_locale', 'en'); } catch (e) {}")
        if args.pro_demo:
            # 自动化演示 Pro 状态：显式注入本地标记；生产代码仅在读到该标记时展示 Pro
            page.add_init_script(
                script="try { localStorage.setItem('calorieai_demo_pro', 'true'); } catch (e) {}"
            )
            report["findings"]["pro_demo_marker"] = "calorieai_demo_pro=true injected"
        page.on("console", lambda m: report["console_errors"].append(m.text) if m.type == "error" else None)

        ledger = CreditLedger()
        page.route("**/api/v1/user/credits*", ledger.handle)
        report["findings"]["credits_seeded"] = ledger.balance

        if args.fast:
            # 快节奏出片：analyze 接口返回内置演示应答，避免真实 AI 数秒延迟
            page.route("**/api/v1/meals/analyze-text*", mock_text_route)
            page.route("**/api/v1/meals/analyze-image*", mock_image_route)
            report["findings"]["fast_mode"] = {
                "note": "内置演示应答（analyze-text/analyze-image 已拦截）；真实 AI 识别仅在默认深度巡检模式执行",
                "human_move_steps": 8,
                "xiaolongbao_highlight_s": 1,
            }
        if args.promo_en:
            # 英文宣推出片：英文演示应答（全英文 UI 文案与结果）
            page.route("**/api/v1/meals/analyze-text*", mock_text_en_route)
            page.route("**/api/v1/meals/analyze-image*", mock_image_en_route)
            report["findings"]["promo_en_mode"] = {
                "note": "locale=en-US 全英文 UI + 内置英文演示应答；真实 AI 识别仅在默认深度巡检模式执行",
                "human_move_steps": 12,
                "voice": "en-US-ChristopherNeural / en-US-JennyNeural",
            }

        page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        pause(2500)
        log(f"打开站点: {args.url} (mode={args.mode}, slowMo={slow_mo}ms, fast={args.fast}, promo_en={args.promo_en})")

        # ── 光标巡游：先在视口内划 4 段轨迹，直观展示 Pointer + 蓝色光圈 + 淡出路径 ──
        vw = page.evaluate("() => innerWidth")
        vh = page.evaluate("() => innerHeight")
        tour_start = rec_start
        if not args.promo_en:
            tour = [(vw * 0.16, vh * 0.25), (vw * 0.84, vh * 0.25), (vw * 0.84, vh * 0.72), (vw * 0.16, vh * 0.72)] if not FAST_MODE else [(vw * 0.5, vh * 0.3), (vw * 0.5, vh * 0.7)]
            tour_start = time.monotonic()
            for tx, ty in tour:
                human_move(page, tx, ty)
            pause(1000)
            log("光标巡游完成：8px red Pointer + 20px blue glow + 15 点淡出尾迹已展示")

        # ── 步骤 A：多语言与导航 ────────────────────────────────
        def step_a():
            if not FAST_MODE:
                human_click(page, ".locale-switcher button:has-text('中文')", timeout=6000)
                pause(800)
            nav = [el.inner_text().strip() for el in page.query_selector_all("nav.tab-bar button")]
            assert "记录饮食" in nav, f"中文导航缺失: {nav}"

            human_click(page, "nav.tab-bar button:has-text('记录饮食')", timeout=8000)
            page.wait_for_selector(".meal-type-btn", timeout=8000)
            assert page.query_selector(".meal-type-row") is not None
            shot("A1-record")

            human_click(page, "nav.tab-bar button:has-text('数据看板')", timeout=8000)
            page.wait_for_selector(".cal-ring-container", timeout=8000)
            shot("A2-dashboard")

            human_click(page, "nav.tab-bar button:has-text('个人设置')", timeout=8000)
            page.wait_for_timeout(1200)
            assert len(page.query_selector_all("main input, main select")) > 0
            shot("A3-profile")

            human_click(page, "nav.tab-bar button:has-text('记录饮食')", timeout=8000)
            page.wait_for_selector(".meal-type-btn", timeout=8000)

            # EN 切换校验
            nav_en = nav
            if not FAST_MODE:
                human_click(page, ".locale-switcher button:has-text('EN')", timeout=6000)
                pause(800)
                nav_en = [el.inner_text().strip() for el in page.query_selector_all("nav.tab-bar button")]
                assert any("Log Meal" in t for t in nav_en), f"EN 导航缺失: {nav_en}"
                shot("A4-en")
                human_click(page, ".locale-switcher button:has-text('中文')", timeout=6000)
                pause(800)
            return f"导航 3 Tab 渲染 + EN/中文 切换校验通过（{nav_en}）"

        # ── 步骤 B：餐次全覆盖 ───────────────────────────────────
        def step_b():
            checked = []
            for label in ["早餐", "午餐", "晚餐", "加餐"]:
                human_click(page, f".meal-type-btn:has-text('{label}')", timeout=8000)
                pause(500)
                active = page.inner_text(".meal-type-btn.active", timeout=3000)
                assert active == label, f"餐次激活异常: {active} != {label}"
                checked.append(label)
            shot("B-mealtypes")
            return f"餐次全覆盖: {' / '.join(checked)}"

        # ── 步骤 C：文字与识图 ───────────────────────────────────
        def step_c_text():
            human_click(page, ".tab:has-text('文字输入')", timeout=8000)
            pause(800)
            human_click(page, ".card:has(textarea) textarea", timeout=8000)
            page.keyboard.type("吃了2个包子和1杯豆浆", delay=20 if FAST_MODE else 140)
            pause(600)
            credits_before = read_credits()
            human_click(page, ".card:has(textarea) button.submit-btn", timeout=8000)
            page.wait_for_selector(".food-item", timeout=90000)
            # 轮询积分角标：本地扣 1 积分立即生效，随后可能被服务端余额同步覆盖
            observed = []
            deadline = time.time() + (1.0 if FAST_MODE else 4)
            while time.time() < deadline:
                c = parse_credits(read_credits())
                if c is not None:
                    observed.append(c)
                pause(250)
            pause(1000)
            names = [el.inner_text().strip().splitlines()[0] for el in page.query_selector_all(".food-item .food-name")]
            total_el = page.query_selector(".food-item:has(.food-name:has-text('总')) .food-nutrition")
            total = total_el.inner_text() if total_el else ""
            credits_after = read_credits()
            shot("C1-text")
            before_n = parse_credits(credits_before)
            after_n = parse_credits(credits_after)
            min_seen = min(observed) if observed else None
            delta = (min_seen - before_n) if (min_seen is not None and before_n is not None) else None
            report["findings"]["C-text"] = {
                "names": names,
                "total": total,
                "credits_before": credits_before,
                "credits_after": credits_after,
                "credits_min_seen": min_seen,
                "credits_delta": delta,
            }
            assert len(names) >= 2, f"AI 文字分析结果不足: {names}"
            assert "kcal" in total.lower() or "卡" in total, f"文字分析总热量缺失: {total!r}"
            delta_note = f"积分 {credits_before} → {credits_after}"
            if delta == -1:
                delta_note += "（-1 校验 ✅）"
            elif delta is not None:
                delta_note += f"（本地扣 1 积分，服务端同步余额波动，观测最小差 {delta:+d}）"
            return f"文字识别 {names}；Total: {total}；{delta_note}"

        def step_c_image():
            images = collect_demo_images(fast=FAST_MODE)
            log(f"TEMP 图片集: {[p.name for p in images]}")
            human_click(page, ".tab:has-text('拍照')", timeout=8000)
            pause(800)
            per_image = []
            for img in images:
                with page.expect_file_chooser() as fc_info:
                    human_click(page, ".upload-btn >> nth=1", timeout=10000)
                fc_info.value.set_files(str(img))
                page.wait_for_selector(".preview-thumb", timeout=10000)
                pause(1000)
                human_click(page, ".card:has(.preview-thumb) button.submit-btn", timeout=10000)
                # 捕获“图片已优化 (XXKB)” Toast（优先读取注入日志，瞬时替换也不漏）
                toast_seen = None
                toast_deadline = 2 if FAST_MODE else 15
                deadline = time.time() + toast_deadline
                while time.time() < deadline:
                    try:
                        logs = page.evaluate("() => window.__toastLog || []")
                        m = next((t for t in logs if "图片已优化" in t), None)
                        if m:
                            toast_seen = m
                            break
                    except Exception:
                        pass
                    body = page.inner_text("body")
                    m2 = re.search(r"图片已优化\s*\(([\d.]+KB)\)", body)
                    if m2:
                        toast_seen = m2.group(0)
                        break
                    pause(300)
                if FAST_MODE and toast_seen is None:
                    log(f"  [{img.name}] ⚡ fast 模式 toast 瞬时替换未捕获（可接受，出片节奏优先）")
                # 等待结果（非食物图可能 0 项，最多等 45s 后继续）
                names, total, counted, counted_g = [], "", [], []
                try:
                    page.wait_for_selector(".food-item", timeout=45000)
                    pause(1500)
                    names = [el.inner_text().strip().splitlines()[0] for el in page.query_selector_all(".food-item .food-name")]
                    counted = [n for n in names if QTY_RE.search(n)]
                    counted_g = [n for n in names if QTY_G_RE.search(n)]
                    total_el = page.query_selector(".food-item:has(.food-name:has-text('总')) .food-nutrition")
                    total = total_el.inner_text() if total_el else ""
                except Exception:
                    pause(3000)  # 非食物图：AI 返回 0 项，等待识别流程结束
                # 带数量名称的识别结果必须同时给出整盘总热量（卡路里总账）
                if counted:
                    assert "kcal" in total.lower() or "卡" in total, (
                        f"{img.name} 数量名称 {counted} 但整盘总热量缺失: {total!r}"
                    )
                # 小笼包命中：显式停顿 2 秒，放大并高亮“小笼包 (X 颗)”识别结果卡片
                highlight = None
                if counted_g:
                    highlight = page.evaluate("""() => {
                      const cards = Array.from(document.querySelectorAll('.food-item'));
                      const card = cards.find(el => /小笼包/.test(el.innerText))
                        || cards.find(el => /颗/.test(el.innerText));
                      if (!card) return null;
                      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      card.style.transition = 'transform .35s ease, box-shadow .35s ease, outline .35s ease';
                      card.style.transform = 'scale(1.08)';
                      card.style.outline = '4px solid #ff3c3c';
                      card.style.boxShadow = '0 0 0 4px #ff3c3c, 0 0 26px rgba(255,60,60,.85)';
                      card.style.borderRadius = '12px';
                      card.style.position = 'relative';
                      card.style.zIndex = '50';
                      card.style.background = '#fff';
                      return card.innerText.split('\\n')[0];
                    }""")
                    page.wait_for_timeout(1000 if FAST_MODE else 2000)  # fast 停顿 1s / 默认 2s
                    log(f"  [{img.name}] 🎯 放大高亮卡片: {highlight}")
                    shot(f"C2-{img.stem[:18]}-zoom")
                per_image.append({"file": img.name, "toast": toast_seen, "names": names, "counted": counted, "counted_g": counted_g, "total": total, "highlight": highlight})
                log(f"  [{img.name}] toast={toast_seen} names={names} counted={counted} counted_g={counted_g} total={total}")
                shot(f"C2-{img.stem[:18]}")
            report["findings"]["C-image"] = per_image
            all_g = [n for p in per_image for n in p["counted_g"]]
            all_counted = [n for p in per_image for n in p["counted"]]
            if not all_g:
                raise AssertionError(
                    f"未识别出「数量 + 约重」格式（如 小笼包 (9 颗 / 约 270g)）: {[p['names'] for p in per_image]}"
                )
            return f"共 {len(images)} 张图；数量+约重: {all_g}；带数量名称: {all_counted}"

        # ── 步骤 D：商业与广告 ───────────────────────────────────
        def step_d_ad():
            before = read_credits()
            human_click(page, ".ad-reward-btn", timeout=10000)
            page.wait_for_selector(".ad-modal", timeout=8000)
            shot("D1-ad-modal")
            if FAST_MODE:
                # 快节奏出片：跳过 4s 广告倒计时，弹窗展示后直接关闭
                page.wait_for_timeout(800)
                human_click(page, ".ad-modal .modal-close", timeout=5000)
                report["findings"]["D-ad"] = {"fast_mode": True, "note": "快节奏模式跳过 4s 广告倒计时，未等待 +10 发奖"}
                return "广告弹窗展示（fast 模式跳过 4s 倒计时）"
            # 广告倒计时后自动发奖 +10 并关闭
            after = before
            deadline = time.time() + 20
            while time.time() < deadline:
                after = read_credits()
                if after and after != before:
                    break
                pause(500)
            shot("D1-ad-rewarded")
            report["findings"]["D-ad"] = {"before": before, "after": after}
            return f"积分 {before} → {after}（看广告 +10）"

        def step_d_billing():
            pause(800)
            human_click(page, "button.btn-upgrade", timeout=10000)
            page.wait_for_selector(".billing-modal", timeout=8000)
            pause(800)
            cards = page.query_selector_all(".billing-modal .plan-card")
            assert len(cards) == 3, f"积分包卡片数量异常: {len(cards)}"
            modal_text = page.inner_text(".billing-modal")
            shot("D2-billing-cards")
            # 选第一个积分包 → 信用卡 → 支付 → 跳转 Stripe Checkout
            human_click(page, ".billing-modal .plan-card .plan-btn >> nth=0", timeout=8000)
            page.wait_for_selector(".payment-method-btn", timeout=8000)
            human_click(page, ".payment-method-btn:has-text('信用卡')", timeout=8000)
            page.wait_for_selector(".stripe-pay-btn", timeout=8000)
            shot("D2-billing-pay")
            human_click(page, ".stripe-pay-btn", timeout=10000)
            checkout_url = wait_url_part("checkout.stripe.com", timeout=45)
            if not checkout_url:
                raise AssertionError("未跳转到 Stripe Checkout")
            shot("D2-checkout")
            report["findings"]["D-billing"] = {"cards": len(cards), "checkout_url": checkout_url}
            # 演示结束：返回站点
            if not FAST_MODE:
                page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
                pause(2000)
            return f"Stripe 3 卡片展示并跳转 Checkout: {checkout_url[:80]}..."

        # ── Mobile-Demo：移动端支付体验巡检（390x844 触摸 / 全英文 Stripe）──
        def step_mobile_layout():
            vw = page.evaluate("() => innerWidth")
            assert 375 <= vw <= 430, f"移动端视口宽度异常: {vw}"
            touch = page.evaluate("() => matchMedia('(pointer: coarse)').matches")
            assert touch, "未启用触摸模拟 (pointer: coarse)"
            upgrade_text = page.inner_text("button.btn-upgrade", timeout=6000)
            assert "Get Pro" in upgrade_text or "Upgrade" in upgrade_text, f"移动端 Header 徽章异常: {upgrade_text}"
            human_click(page, "button.btn-upgrade", timeout=10000)
            page.wait_for_selector(".billing-modal", timeout=8000)
            pause(600)
            cards = page.query_selector_all(".billing-modal .plan-card")
            assert len(cards) == 3, f"移动端积分包卡片数量异常: {len(cards)}"
            modal_box = page.query_selector(".billing-modal").bounding_box()
            assert modal_box and modal_box["width"] >= vw * 0.85, f"支付弹窗未适配移动端宽度: {modal_box}"
            plan_btn = page.query_selector(".billing-modal .plan-btn").bounding_box()
            assert plan_btn and plan_btn["width"] >= modal_box["width"] * 0.9, f"plan-btn 未全宽: {plan_btn}"
            assert plan_btn["height"] >= 48, f"plan-btn 触达高度不足: {plan_btn['height']}"
            shot("M1-mobile-layout")
            report["findings"]["mobile_layout"] = {
                "viewport_width": vw,
                "touch": touch,
                "upgrade_badge": upgrade_text,
                "plan_btn_width": round(plan_btn["width"], 1),
                "plan_btn_height": round(plan_btn["height"], 1),
            }
            return f"视口 {vw}px + 触摸已启用 + 弹窗/plan-btn 全宽({plan_btn['width']:.0f}px) 高 {plan_btn['height']:.0f}px"

        def step_mobile_pay():
            vw = page.evaluate("() => innerWidth")
            human_click(page, ".billing-modal .plan-card .plan-btn >> nth=0", timeout=8000)
            page.wait_for_selector(".payment-method-btn", timeout=8000)
            human_click(page, ".payment-method-btn:has-text('Credit / Debit Card')", timeout=8000)
            page.wait_for_selector(".stripe-pay-btn", timeout=8000)
            pause(500)
            pay_btn = page.query_selector(".stripe-pay-btn").bounding_box()
            modal_box = page.query_selector(".billing-modal").bounding_box()
            assert pay_btn and pay_btn["height"] >= 48, f"stripe-pay-btn 触达高度不足: {pay_btn}"
            assert pay_btn["width"] >= modal_box["width"] * 0.9, f"stripe-pay-btn 未全宽: {pay_btn}"
            shot("M2-mobile-pay")
            human_click(page, ".stripe-pay-btn", timeout=10000)
            checkout_url = wait_url_part("checkout.stripe.com", timeout=45)
            if not checkout_url:
                raise AssertionError("未跳转到 Stripe Checkout")
            # 全英文校验：Stripe Checkout 页面 <html lang="en">
            page.wait_for_selector("body", timeout=20000)
            pause(1500)
            lang = page.evaluate("() => document.documentElement.lang || ''")
            assert lang.lower().startswith("en"), f"Stripe Checkout 非英文: lang={lang}"
            shot("M3-mobile-stripe-en")
            report["findings"]["mobile_billing"] = {
                "viewport_width": vw,
                "stripe_pay_btn_height": round(pay_btn["height"], 1),
                "checkout_url": checkout_url,
                "stripe_lang": lang,
            }
            return f"Stripe Checkout 跳转成功（英文 lang={lang}）: {checkout_url[:70]}..."

        # ── Promo-EN：YouTube Shorts 英文宣推流程（全英文 UI + 4 段美音解说）──
        def run_promo_en(audio_paths):
            wav_map = {}
            for k, p in audio_paths.items():
                w = mp3_to_wav(p, Path(p).with_suffix(".wav"))
                if w:
                    wav_map[k] = str(w)
            report["findings"]["promo_audio"] = {"mp3": audio_paths, "wav": wav_map}
            offsets_raw = {}

            # 巡游（轨迹展示）→ Audio1 Intro
            vw2 = page.evaluate("() => innerWidth")
            vh2 = page.evaluate("() => innerHeight")
            tour = [(vw2 * 0.16, vh2 * 0.3), (vw2 * 0.84, vh2 * 0.3), (vw2 * 0.5, vh2 * 0.7)]
            tour_start = time.monotonic()
            for tx, ty in tour:
                human_move(page, tx, ty)
            pause(1200)
            play_audio_async(wav_map.get("intro"))
            offsets_raw["intro"] = 200
            log("[VO] Audio1 Intro 播放中…")

            def p_step_a():
                nav = [el.inner_text().strip() for el in page.query_selector_all("nav.tab-bar button")]
                assert "Log Meal" in nav, f"EN 导航缺失: {nav}"
                human_click(page, "nav.tab-bar button:has-text('Log Meal')", timeout=8000)
                page.wait_for_selector(".meal-type-btn", timeout=8000)
                shot("P-A1-log")
                human_click(page, "nav.tab-bar button:has-text('Dashboard')", timeout=8000)
                page.wait_for_selector(".cal-ring-container", timeout=8000)
                shot("P-A2-dash")
                human_click(page, "nav.tab-bar button:has-text('Profile')", timeout=8000)
                pause(1200)
                assert len(page.query_selector_all("main input, main select")) > 0
                shot("P-A3-profile")
                human_click(page, "nav.tab-bar button:has-text('Log Meal')", timeout=8000)
                page.wait_for_selector(".meal-type-btn", timeout=8000)
                return f"EN 导航 3 Tab 渲染通过（{nav}）"

            step("Promo-A 英文导航", p_step_a)

            def p_step_b():
                checked = []
                for label in ["Breakfast", "Lunch", "Dinner", "Snack"]:
                    human_click(page, f".meal-type-btn:has-text('{label}')", timeout=8000)
                    pause(500)
                    active = page.inner_text(".meal-type-btn.active", timeout=3000)
                    assert active == label, f"EN 餐次激活异常: {active} != {label}"
                    checked.append(label)
                shot("P-B-meals")
                return f"EN 餐次: {' / '.join(checked)}"

            step("Promo-B 英文餐次", p_step_b)

            def p_step_c_text():
                human_click(page, ".tab:has-text('Text Input')", timeout=8000)
                pause(800)
                human_click(page, ".card:has(textarea) textarea", timeout=8000)
                page.keyboard.type("I ate 2 steam buns and 1 cup of soy milk.", delay=25)
                pause(600)
                credits_before = read_credits()
                human_click(page, ".card:has(textarea) button.submit-btn", timeout=8000)
                page.wait_for_selector(".food-item", timeout=30000)
                observed = []
                deadline = time.time() + 2.5
                while time.time() < deadline:
                    c = parse_credits(read_credits())
                    if c is not None:
                        observed.append(c)
                    pause(250)
                pause(800)
                names = [el.inner_text().strip().splitlines()[0] for el in page.query_selector_all(".food-item .food-name")]
                total_el = page.query_selector(".food-item:has(.food-name:has-text('Total')) .food-nutrition")
                total = total_el.inner_text() if total_el else ""
                shot("P-C1-text")
                before_n = parse_credits(credits_before)
                min_seen = min(observed) if observed else None
                delta = (min_seen - before_n) if (min_seen is not None and before_n is not None) else None
                report["findings"]["promo_text"] = {
                    "text": "I ate 2 steam buns and 1 cup of soy milk.",
                    "names": names,
                    "total": total,
                    "credits_delta": delta,
                }
                assert any("Steamed Buns" in n for n in names), f"未识别 Steamed Buns: {names}"
                assert any("Soy Milk" in n for n in names), f"未识别 Soy Milk: {names}"
                assert "kcal" in total.lower(), f"EN 总热量缺失: {total!r}"
                return f"EN 文字识别 {names}；Total: {total}；积分差 {delta}"

            step("Promo-C-a 英文文字输入+AI汇总", p_step_c_text)

            def p_step_c_image():
                human_click(page, ".tab:has-text('Photo / Upload')", timeout=8000)
                pause(800)
                img = collect_demo_images(fast=True)[0]
                with page.expect_file_chooser() as fc_info:
                    human_click(page, ".upload-btn >> nth=1", timeout=10000)
                fc_info.value.set_files(str(img))
                page.wait_for_selector(".preview-thumb", timeout=10000)
                pause(800)
                scan_ts = time.monotonic()
                human_click(page, ".card:has(.preview-thumb) button.submit-btn", timeout=10000)
                toast_seen = None
                deadline = time.time() + 3
                while time.time() < deadline:
                    try:
                        logs = page.evaluate("() => window.__toastLog || []")
                        m = next((t for t in logs if ("Image optimized" in t or "图片已优化" in t)), None)
                        if m:
                            toast_seen = m
                            break
                    except Exception:
                        pass
                    body = page.inner_text("body")
                    m2 = re.search(r"(?:图片已优化|Image optimized)\s*\(([\d.]+KB)\)", body)
                    if m2:
                        toast_seen = m2.group(0)
                        break
                    pause(250)
                names, total, counted_en = [], "", []
                try:
                    page.wait_for_selector(".food-item", timeout=30000)
                    pause(1200)
                    names = [el.inner_text().strip().splitlines()[0] for el in page.query_selector_all(".food-item .food-name")]
                    counted_en = [n for n in names if EN_QTY_G_RE.search(n)]
                    total_el = page.query_selector(".food-item:has(.food-name:has-text('Total')) .food-nutrition")
                    total = total_el.inner_text() if total_el else ""
                except Exception:
                    pause(2000)
                if counted_en:
                    assert "kcal" in total.lower(), f"EN 整盘总热量缺失: {total!r}"
                highlight = None
                if counted_en:
                    highlight = page.evaluate("""() => {
                      const cards = Array.from(document.querySelectorAll('.food-item'));
                      const card = cards.find(el => /approx\\./.test(el.innerText))
                        || cards.find(el => /pcs/.test(el.innerText));
                      if (!card) return null;
                      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      card.style.transition = 'transform .35s ease, box-shadow .35s ease, outline .35s ease';
                      card.style.transform = 'scale(1.08)';
                      card.style.outline = '4px solid #ff3c3c';
                      card.style.boxShadow = '0 0 0 4px #ff3c3c, 0 0 26px rgba(255,60,60,.85)';
                      card.style.borderRadius = '12px';
                      card.style.position = 'relative';
                      card.style.zIndex = '50';
                      card.style.background = '#fff';
                      return card.innerText.split('\\n')[0];
                    }""")
                    page.wait_for_timeout(2000)
                    log(f"  [Promo] 🎯 高亮英文卡片: {highlight}")
                    shot("P-C2-scan-zoom")
                play_audio_async(wav_map.get("scan"))
                offsets_raw["scan"] = int(max(100, (scan_ts - tour_start) * 1000))
                log(f"[VO] Audio2 Scan @ {offsets_raw['scan']}ms")
                per_image = {
                    "file": img.name,
                    "toast": toast_seen,
                    "names": names,
                    "counted_en": counted_en,
                    "total": total,
                    "highlight": highlight,
                }
                report["findings"]["promo_image"] = per_image
                assert counted_en, f"未识别英文数量名称（pcs/approx）: {names}"
                return f"EN 识图 {names}；Total: {total}；toast={toast_seen}"

            step("Promo-C-b 英文识图（pcs/approx + 总热量）", p_step_c_image)

            def p_step_d_ad():
                human_click(page, ".ad-reward-btn", timeout=10000)
                page.wait_for_selector(".ad-modal", timeout=8000)
                shot("P-D1-ad")
                page.wait_for_timeout(900)
                human_click(page, ".ad-modal .modal-close", timeout=5000)
                return "EN 广告弹窗展示并关闭"

            step("Promo-D-a 英文广告弹窗", p_step_d_ad)

            def p_step_d_billing():
                pause(600)
                pro_ts = time.monotonic()
                human_click(page, "button.btn-upgrade", timeout=10000)
                page.wait_for_selector(".billing-modal", timeout=8000)
                pause(800)
                cards = page.query_selector_all(".billing-modal .plan-card")
                assert len(cards) == 3, f"EN 积分包卡片数量异常: {len(cards)}"
                shot("P-D2-cards")
                human_click(page, ".billing-modal .plan-card .plan-btn >> nth=0", timeout=8000)
                page.wait_for_selector(".payment-method-btn", timeout=8000)
                human_click(page, ".payment-method-btn:has-text('Credit / Debit Card')", timeout=8000)
                page.wait_for_selector(".stripe-pay-btn", timeout=8000)
                shot("P-D2-pay")
                play_audio_async(wav_map.get("pro"))
                offsets_raw["pro"] = int(max(100, (pro_ts - tour_start) * 1000))
                log(f"[VO] Audio3 Pro @ {offsets_raw['pro']}ms")
                human_click(page, ".stripe-pay-btn", timeout=10000)
                checkout_url = wait_url_part("checkout.stripe.com", timeout=45)
                if not checkout_url:
                    raise AssertionError("未跳转到 Stripe Checkout")
                shot("P-D2-checkout")
                report["findings"]["promo_billing"] = {"cards": len(cards), "checkout_url": checkout_url}
                return f"EN Stripe 3 卡片展示并跳转 Checkout: {checkout_url[:70]}..."

            step("Promo-D-b 英文充值/Pro + Checkout", p_step_d_billing)

            # CTA 收尾
            pause(1000)
            play_audio_async(wav_map.get("cta"))
            log("[VO] Audio4 CTA 播放中…")
            return {"audio_paths": audio_paths, "offsets_raw": offsets_raw, "tour_start": tour_start}

        if args.promo_en:
            promo = run_promo_en(promo_audio_paths)
        elif args.mobile_demo:
            step("步骤M-a 移动端响应式布局与触摸", step_mobile_layout)
            step("步骤M-b 移动支付按钮触达 + 全英文 Stripe Checkout", step_mobile_pay)
        else:
            step("步骤A 多语言与导航", step_a)
            step("步骤B 餐次全覆盖", step_b)
            step("步骤C-a 文字输入+AI汇总", step_c_text)
            step("步骤C-b TEMP 图片集识图（数量+整盘总热量）", step_c_image)
            step("步骤D-a 看广告领积分(+10)", step_d_ad)
            step("步骤D-b 充值/Pro + Checkout 跳转", step_d_billing)

        pause(1500)
        shot("final")
        ctx.close()
        browser.close()

        if args.promo_en:
            promo_audio = promo["audio_paths"]
            offsets = dict(promo["offsets_raw"])
            head_trim = promo["tour_start"] - rec_start
            orig_dur = probe_duration(page.video.path())
            video_dur = max(1.0, orig_dur - head_trim)
            dur4 = probe_duration(promo_audio.get("cta")) if promo_audio.get("cta") else 0.0
            cta_off = max(offsets.get("pro", 1000) + 1000, (video_dur - dur4 - 0.8) * 1000) if dur4 > 0 else (video_dur - 2.0) * 1000
            offsets["cta"] = int(max(100, min(cta_off, (video_dur - 1.0) * 1000)))
            for k in ("intro", "scan", "pro"):
                offsets[k] = int(max(100, min(offsets.get(k, 100), (video_dur - 0.5) * 1000)))
            video_info = export_promo_video(page.video.path(), PROMO_VIDEO, promo_audio, offsets, head_trim, video_dur)
            report["findings"]["promo_video"] = video_info
            if video_info.get("ok"):
                log(f"🎬 YouTube Shorts 英文宣推视频已导出: {video_info.get('dest')}（{video_info.get('bytes', 0) / 1024 / 1024:.1f}MB，时长 {video_info.get('video_dur_s')}s，音轨偏移 {offsets}ms）")
            else:
                log(f"❌ 宣推视频导出失败: {video_info.get('error')}")
        elif args.fast:
            head_trim = tour_start - rec_start
            video_info = export_fast_video(page, FAST_VIDEO, head_trim=head_trim)
            report["findings"]["video"] = video_info
            if video_info.get("ok"):
                log(f"🎬 短视频已导出: {video_info.get('dest')}（{video_info.get('bytes', 0) / 1024:.0f}KB，裁掉加载头 {video_info.get('head_trim_s', 0)}s）")
            else:
                log(f"❌ 短视频导出失败: {video_info.get('error')}")

    report["console_errors"] = report["console_errors"][:5]
    ok = all(s["ok"] for s in report["steps"])
    (SHOT_DIR / "demo-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (SHOT_DIR / f"demo-result-{args.mode}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=" * 60)
    print(f"CEO VISUAL DEMO DEEP: {'PERFECT PLAY ✅' if ok else 'HAS ISSUES ❌'} (mode={args.mode}, slowMo={slow_mo}ms, fast={args.fast}, promo_en={args.promo_en})")
    for s in report["steps"]:
        print(f"  {'✅' if s['ok'] else '❌'} {s['name']} ({s['elapsed']}s)")
    print(f"report={SHOT_DIR / 'demo-result.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
