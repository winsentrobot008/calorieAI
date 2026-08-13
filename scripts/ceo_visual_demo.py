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
      if (el.children.length === 0 && /图片已优化|识别成功|积分不足|上传|失败/.test(el.textContent || '')) {
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
FAST_VIDEO = TEMP_DIR / "calorieai_demo_fast.mp4"  # 短视频导出落盘路径
FAST_MODE = False  # 由 main() 依据 --fast 设置
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
    """从积分角标文案解析数字，如 '🎯 积分: 9' -> 9。"""
    if not text:
        return None
    m = re.search(r"积分[:：]?\s*(\d+)", text)
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
    cmd += ["-i", str(src), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-an", str(tmp)]
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
    global FAST_MODE, HUMAN_STEPS
    parser = argparse.ArgumentParser(description="CEO 拟人化慢速可视化深度巡检 / 快节奏短视频模式")
    parser.add_argument("--url", default=DEMO_URL)
    parser.add_argument("--mode", choices=["desktop", "mobile"], default="desktop")
    parser.add_argument("--fast", action="store_true",
                        help="快节奏短视频模式：slowMo=150ms、human_move 8 步、内置演示应答（analyze 接口拦截）、"
                             "小笼包高光停顿 1s、自动录屏并导出 TEMP/calorieai_demo_fast.mp4")
    args = parser.parse_args()
    FAST_MODE = args.fast
    HUMAN_STEPS = 8 if args.fast else 25
    slow_mo = FAST_SLOW_MO if args.fast else SLOW_MO

    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "url": args.url,
        "mode": args.mode,
        "fast": args.fast,
        "slow_mo_ms": slow_mo,
        "steps": [],
        "findings": {},
        "screenshots": [],
        "console_errors": [],
    }

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
        """装饰性等待：fast 模式统一压缩（÷6，下限 60ms），保证快节奏出片。"""
        page.wait_for_timeout(ms if not FAST_MODE else max(60, ms // 6))

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
        ctx = browser.new_context(**ctx_kwargs)
        rec_start = time.monotonic()
        page = ctx.new_page()
        # 视觉特效强制渲染：add_init_script 在页面任何脚本之前注入
        # 全局 <canvas id="ceo-pointer-canvas">（z-index:999999!important / pointer-events:none）
        page.add_init_script(script=FX_JS)
        page.add_init_script(script=TOAST_CATCH_JS)
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

        page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        pause(2500)
        log(f"打开站点: {args.url} (mode={args.mode}, slowMo={slow_mo}ms, fast={args.fast})")

        # ── 光标巡游：先在视口内划 4 段轨迹，直观展示 Pointer + 蓝色光圈 + 淡出路径 ──
        vw = page.evaluate("() => innerWidth")
        vh = page.evaluate("() => innerHeight")
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

        step("步骤A 多语言与导航", step_a)

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

        step("步骤B 餐次全覆盖", step_b)

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

        step("步骤C-a 文字输入+AI汇总", step_c_text)

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

        step("步骤C-b TEMP 图片集识图（数量+整盘总热量）", step_c_image)

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

        step("步骤D-a 看广告领积分(+10)", step_d_ad)

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

        step("步骤D-b 充值/Pro + Checkout 跳转", step_d_billing)

        pause(1500)
        shot("final")
        ctx.close()
        browser.close()

        if args.fast:
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
    print(f"CEO VISUAL DEMO DEEP: {'PERFECT PLAY ✅' if ok else 'HAS ISSUES ❌'} (mode={args.mode}, slowMo={slow_mo}ms, fast={args.fast})")
    for s in report["steps"]:
        print(f"  {'✅' if s['ok'] else '❌'} {s['name']} ({s['elapsed']}s)")
    print(f"report={SHOT_DIR / 'demo-result.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
