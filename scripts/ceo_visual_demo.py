# -*- coding: utf-8 -*-
"""
ceo_visual_demo.py — CEO 专属拟人化慢速可视化巡检（Playwright Visual Demo）

特性：
  - 有头模式 headless=False + slowMo=1200ms：鼠标移动 / 点击 / 打字全部放慢 1.2s；
  - 屏幕高亮鼠标光标 + 点击红点波纹（真人手势 / 鼠标轨迹模拟）；
  - 两种模式：桌面端 1280x800 / 移动端 iPhone 14 Viewport + 真实 Touch 触摸事件。

演示路径（严格对齐 PROJECT_SPEC 规格）：
  步骤 1  打开线上站点 → 缓慢移动至餐次选择 → 点击「午餐」
  步骤 2  文字输入「吃了 2 个包子和 1 杯豆浆」→ 点击 AI 分析 → 展示动态卡路里 + P/F/C 汇总 + 积分 -1
  步骤 3  切换图片上传 → 上传多数量小笼包图 → 验证 AI 输出「食物名称 (X 颗)」与整盘总卡路里
  步骤 4  点击「充值/Pro」→ 展示 Stripe 积分卡片弹框与价格；再看广告弹框

用法：
  npm run demo:visual                                # 桌面端，线上生产 URL
  python scripts/ceo_visual_demo.py --mode mobile    # iPhone 14 移动端模拟
  python scripts/ceo_visual_demo.py --url http://127.0.0.1:3100
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DEMO_URL = "https://calorie-ai-seven.vercel.app/"
ASSET = ROOT / "scripts" / "assets" / "demo-food.jpg"
SHOT_DIR = ROOT / "qa-logs"
SLOW_MO = 1200  # 所有操作放慢 1.2s

IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

CURSOR_JS = r"""
(() => {
  if (window.__ceoCursor) return;
  const style = 'position:fixed;pointer-events:none;z-index:999999;';
  const dot = document.createElement('div');
  dot.id = '__ceoCursorDot';
  dot.style.cssText = style + 'left:0;top:0;width:14px;height:14px;border-radius:50%;' +
    'background:rgba(255,60,60,.95);box-shadow:0 0 10px rgba(255,60,60,.9);transform:translate(-50%,-50%);';
  const ring = document.createElement('div');
  ring.id = '__ceoCursorRing';
  ring.style.cssText = style + 'left:0;top:0;width:36px;height:36px;border:2px solid rgba(96,165,250,.95);' +
    'border-radius:50%;transform:translate(-50%,-50%);transition:left .12s linear, top .12s linear;';
  document.body.appendChild(dot);
  document.body.appendChild(ring);
  document.addEventListener('mousemove', (e) => {
    dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px';
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
  }, { passive: true });
  const ripple = (x, y) => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:22px;height:22px;border-radius:50%;' +
      'border:3px solid rgba(255,70,70,.95);pointer-events:none;z-index:999997;' +
      'transform:translate(-50%,-50%) scale(.35);opacity:1;transition:transform .5s ease-out, opacity .5s ease-out;';
    document.body.appendChild(r);
    requestAnimationFrame(() => {
      r.style.transform = 'translate(-50%,-50%) scale(2.4)';
      r.style.opacity = '0';
    });
    setTimeout(() => r.remove(), 600);
  };
  document.addEventListener('pointerdown', (e) => ripple(e.clientX, e.clientY), { passive: true });
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t) ripple(t.clientX, t.clientY);
  }, { passive: true });
  window.__ceoCursor = true;
})();
"""


def log(msg):
    print(f"[demo] {msg}", flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="CEO 拟人化慢速可视化巡检")
    parser.add_argument("--url", default=DEMO_URL)
    parser.add_argument("--mode", choices=["desktop", "mobile"], default="desktop")
    args = parser.parse_args()

    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "url": args.url,
        "mode": args.mode,
        "slow_mo_ms": SLOW_MO,
        "steps": [],
        "findings": {},
        "screenshots": [],
    }
    console_errors = []

    def shot(name):
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
            shot(name.replace(" ", "-"))

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=SLOW_MO)
        if args.mode == "mobile":
            ctx = browser.new_context(
                viewport={"width": 390, "height": 844},
                device_scale_factor=3,
                is_mobile=True,
                has_touch=True,
                user_agent=IPHONE_UA,
            )
        else:
            ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        page.add_script_tag(content=CURSOR_JS)
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        log(f"打开站点: {args.url} (mode={args.mode})")

        # 统一中文界面，便于按中文文案定位（对应 PROJECT_SPEC 演示路径）
        try:
            page.click(".locale-switcher button:has-text('中文')", timeout=6000)
            page.wait_for_timeout(800)
        except Exception:
            pass

        def read_credits():
            try:
                return page.inner_text(".credit-chip", timeout=3000)
            except Exception:
                return None

        # ── 步骤 1：餐次选择（午餐）─────────────────────────────
        def step1():
            page.wait_for_timeout(1200)
            page.click(".meal-type-btn:has-text('午餐')", timeout=10000)
            page.wait_for_timeout(1000)
            shot("step1-mealtype")
            return "已点击「午餐」"

        step("步骤1 餐次选择（午餐）", step1)

        # ── 步骤 2：文字输入 + AI 分析 + 积分 -1 ─────────────────
        def step2():
            page.click(".tab:has-text('文字输入')", timeout=8000)
            page.wait_for_timeout(800)
            textarea = page.locator(".card:has(textarea) textarea")
            textarea.click(timeout=8000)
            page.keyboard.type("吃了 2 个包子和 1 杯豆浆", delay=140)  # 模拟真人逐字打字
            page.wait_for_timeout(600)
            before = read_credits()
            page.click(".card:has(textarea) button.submit-btn", timeout=8000)
            page.wait_for_selector(".food-item", timeout=90000)
            page.wait_for_timeout(1500)
            names = [el.inner_text().strip().splitlines()[0] for el in page.query_selector_all(".food-item .food-name")]
            total = page.inner_text(".food-item:has(.food-name:has-text('总')) .food-nutrition") if page.query_selector(".food-item:has(.food-name:has-text('总'))") else ""
            after = read_credits()
            shot("step2-text-result")
            report["findings"]["step2"] = {"names": names, "credits_before": before, "credits_after": after, "total_row": total}
            return f"文字识别 {names}；积分 {before} → {after}"

        step("步骤2 文字输入 AI 分析 + 积分-1", step2)

        # ── 步骤 3：傻瓜式识图（多数量食物 → 名称带数量 + 整盘总热量）──
        def step3():
            page.click(".tab:has-text('拍照')", timeout=8000)  # zh: 拍照/上传
            page.wait_for_timeout(800)
            with page.expect_file_chooser() as fc_info:
                page.click(".upload-btn >> nth=1", timeout=10000)  # 从相册选择
            fc_info.value.set_files(str(ASSET))
            page.wait_for_selector(".preview-thumb", timeout=10000)
            page.wait_for_timeout(1000)
            page.click(".card:has(.preview-thumb) button.submit-btn", timeout=10000)
            page.wait_for_selector(".food-item", timeout=120000)
            page.wait_for_timeout(1500)
            names = [el.inner_text().strip().splitlines()[0] for el in page.query_selector_all(".food-item .food-name")]
            shot("step3-image-result")
            counted = [n for n in names if re.search(r"\(\s*\d+\s*(颗|块|个|碗|份|只|串|片)", n)]
            report["findings"]["step3"] = {"names": names, "counted_names": counted}
            if not counted:
                raise AssertionError(f"未识别出带数量的食物名称: {names}")
            return f"识图输出带数量名称: {counted}"

        step("步骤3 傻瓜式识图（数量+整盘总热量）", step3)

        # ── 步骤 4：商业化（充值积分卡片 + 看广告）────────────────
        def step4():
            page.wait_for_timeout(1000)
            page.click("button.btn-upgrade", timeout=10000)
            page.wait_for_selector(".billing-modal", timeout=8000)
            page.wait_for_timeout(1000)
            modal_text = page.inner_text(".billing-modal")
            shot("step4-billing-modal")
            page.click(".billing-modal .modal-close", timeout=8000)
            page.wait_for_timeout(1000)
            # 看广告弹框
            page.click(".ad-reward-btn", timeout=10000)
            page.wait_for_selector(".ad-modal", timeout=8000)
            page.wait_for_timeout(1200)
            shot("step4-ad-modal")
            page.click(".ad-modal .modal-close", timeout=8000)
            report["findings"]["step4"] = modal_text[:600]
            return "Stripe 积分卡片弹框与价格已展示；广告弹框已展示"

        step("步骤4 商业化（充值/看广告）", step4)

        page.wait_for_timeout(1500)
        shot("final")
        ctx.close()
        browser.close()

    report["console_errors"] = console_errors[:5]
    ok = all(s["ok"] for s in report["steps"])
    (SHOT_DIR / "demo-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=" * 60)
    print(f"CEO VISUAL DEMO: {'PERFECT PLAY ✅' if ok else 'HAS ISSUES ❌'} (mode={args.mode}, slowMo={SLOW_MO}ms)")
    for s in report["steps"]:
        print(f"  {'✅' if s['ok'] else '❌'} {s['name']} ({s['elapsed']}s)")
    print(f"report={SHOT_DIR / 'demo-result.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
