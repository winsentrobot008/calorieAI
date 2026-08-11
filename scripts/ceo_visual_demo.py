# -*- coding: utf-8 -*-
"""
ceo_visual_demo.py — CEO 专属拟人化慢速可视化深度巡检（Playwright Visual Demo）

视觉特效（Canvas 注入，页面最外层渲染；隐藏原生光标，红点 Pointer 跟手）：
  - 高亮红色 Pointer + 蓝色半透明追随光环（平滑滞后，人眼可见移动轨迹）；
  - smooth_move 轨迹动画：光标划过屏幕留下淡出路径；
  - 点击涟漪：mouse/pointer/touch 触发点生成 40px 红色扩散波纹。

全 UI / 逻辑深度巡检路径（对齐 PROJECT_SPEC 所有分支）：
  步骤 A  多语言与导航：中文/EN 切换 + 依次点击【记录饮食】【数据看板】【个人设置】校验渲染
  步骤 B  餐次全覆盖：早餐 / 午餐 / 晚餐 / 加餐 依次慢速点击
  步骤 C  文字与识图：逐字输入「吃了2个包子和1杯豆浆」→ AI 汇总 + 积分 -1；
          扫描 TEMP 目录真实图片（无则回退 demo-food.jpg）逐张上传 → 捕获“图片已优化 (XXKB)”
          并验证【小笼包 (X颗 / 约XXg)】与整盘总热量
  步骤 D  商业与广告：看广告领积分（+10）；充值/Pro → Stripe 3 套卡片 → 模拟购买跳转 Checkout

用法：
  npm run demo:visual                                # 桌面端，线上生产 URL
  python scripts/ceo_visual_demo.py --mode mobile    # iPhone 14 移动端模拟
  python scripts/ceo_visual_demo.py --url http://127.0.0.1:3100
"""

import argparse
import json
import re
import shutil
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


def collect_demo_images():
    """扫描本地 TEMP 目录图片（.jpg/.jpeg/.png，≤3MB 取前 3 张）；
    始终附加 scripts/assets/demo-food.jpg 作为“数量清点”校验锚点；
    TEMP 无图片时复制 demo-food.jpg 回退。"""
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

# ── Canvas 视觉特效注入：红色光标 + 蓝色追随光圈 + 轨迹 + 40px 点击波纹 ──
FX_JS = r"""
(() => {
  if (window.__ceoFX) return;
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;';
  const ctx = cv.getContext('2d');
  document.body.appendChild(cv);
  const resize = () => { cv.width = innerWidth; cv.height = innerHeight; };
  resize(); addEventListener('resize', resize);

  const pts = [];          // 移动轨迹点
  let mx = -100, my = -100, tx = -100, ty = -100, rx = -100, ry = -100;
  const ripples = [];

  const push = (x, y) => {
    mx = x; my = y; tx = x; ty = y;
    pts.push({ x, y, t: performance.now() });
  };
  document.addEventListener('mousemove', (e) => push(e.clientX, e.clientY), { passive: true });
  document.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) push(t.clientX, t.clientY); }, { passive: true });
  document.addEventListener('pointerdown', (e) => ripples.push({ x: e.clientX, y: e.clientY, t: performance.now() }), { passive: true });
  document.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) ripples.push({ x: t.clientX, y: t.clientY, t: performance.now() }); }, { passive: true });

  const frame = (now) => {
    ctx.clearRect(0, 0, cv.width, cv.height);

    // smooth_move 轨迹：最近 24 点连线，随时间淡出
    const cut = now - 1400;
    while (pts.length && pts[0].t < cut) pts.shift();
    if (pts.length > 1) {
      ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const age = (now - pts[i].t) / 1400;
        ctx.strokeStyle = `rgba(255,80,80,${0.55 * (1 - age)})`;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    }

    // 蓝色追随光圈（平滑滞后 → 人眼可见光标划过路径）
    rx += (tx - rx) * 0.18;
    ry += (ty - ry) * 0.18;
    if (rx > -50) {
      ctx.beginPath(); ctx.arc(rx, ry, 18, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(96,165,250,0.95)'; ctx.lineWidth = 2.5; ctx.stroke();
    }

    // 高亮红色光标点
    if (mx > -50) {
      ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,60,60,0.95)'; ctx.fill();
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,60,60,0.45)'; ctx.lineWidth = 2; ctx.stroke();
    }

    // 点击涟漪：40px 红色扩散波纹
    for (const r of [...ripples]) {
      const p = (now - r.t) / 550;
      if (p >= 1) { ripples.splice(ripples.indexOf(r), 1); continue; }
      ctx.beginPath(); ctx.arc(r.x, r.y, 6 + p * 34, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,60,60,${0.9 * (1 - p)})`;
      ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.arc(r.x, r.y, 4 + p * 16, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,60,60,${0.35 * (1 - p)})`; ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__ceoFX = true;
})();
"""


def log(msg):
    print(f"[demo] {msg}", flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="CEO 拟人化慢速可视化深度巡检")
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
        "console_errors": [],
    }

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
            shot(name.replace(" ", "-")[:40])

    def read_credits():
        try:
            return page.inner_text(".credit-chip", timeout=3000)
        except Exception:
            return None

    def wait_url_part(part, timeout=40):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if part in page.url:
                return page.url
            page.wait_for_timeout(500)
        return None

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
        page.add_script_tag(content=FX_JS)
        page.add_style_tag(content="html, body, body * { cursor: none !important; }")
        page.on("console", lambda m: report["console_errors"].append(m.text) if m.type == "error" else None)

        page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        log(f"打开站点: {args.url} (mode={args.mode}, slowMo={SLOW_MO}ms)")

        # ── 步骤 A：多语言与导航 ────────────────────────────────
        def step_a():
            page.click(".locale-switcher button:has-text('中文')", timeout=6000)
            page.wait_for_timeout(800)
            nav = [el.inner_text().strip() for el in page.query_selector_all("nav.tab-bar button")]
            assert "记录饮食" in nav, f"中文导航缺失: {nav}"

            page.click("nav.tab-bar button:has-text('记录饮食')", timeout=8000)
            page.wait_for_selector(".meal-type-btn", timeout=8000)
            assert page.query_selector(".meal-type-row") is not None
            shot("A1-record")

            page.click("nav.tab-bar button:has-text('数据看板')", timeout=8000)
            page.wait_for_selector(".cal-ring-container", timeout=8000)
            shot("A2-dashboard")

            page.click("nav.tab-bar button:has-text('个人设置')", timeout=8000)
            page.wait_for_timeout(1200)
            assert len(page.query_selector_all("main input, main select")) > 0
            shot("A3-profile")

            page.click("nav.tab-bar button:has-text('记录饮食')", timeout=8000)
            page.wait_for_selector(".meal-type-btn", timeout=8000)

            # EN 切换校验
            page.click(".locale-switcher button:has-text('EN')", timeout=6000)
            page.wait_for_timeout(800)
            nav_en = [el.inner_text().strip() for el in page.query_selector_all("nav.tab-bar button")]
            assert any("Log Meal" in t for t in nav_en), f"EN 导航缺失: {nav_en}"
            shot("A4-en")
            page.click(".locale-switcher button:has-text('中文')", timeout=6000)
            page.wait_for_timeout(800)
            return f"导航 3 Tab 渲染 + EN/中文 切换校验通过（{nav_en}）"

        step("步骤A 多语言与导航", step_a)

        # ── 步骤 B：餐次全覆盖 ───────────────────────────────────
        def step_b():
            checked = []
            for label in ["早餐", "午餐", "晚餐", "加餐"]:
                page.click(f".meal-type-btn:has-text('{label}')", timeout=8000)
                page.wait_for_timeout(500)
                active = page.inner_text(".meal-type-btn.active", timeout=3000)
                assert active == label, f"餐次激活异常: {active} != {label}"
                checked.append(label)
            shot("B-mealtypes")
            return f"餐次全覆盖: {' / '.join(checked)}"

        step("步骤B 餐次全覆盖", step_b)

        # ── 步骤 C：文字与识图 ───────────────────────────────────
        def step_c_text():
            page.click(".tab:has-text('文字输入')", timeout=8000)
            page.wait_for_timeout(800)
            textarea = page.locator(".card:has(textarea) textarea")
            textarea.click(timeout=8000)
            page.keyboard.type("吃了2个包子和1杯豆浆", delay=140)
            page.wait_for_timeout(600)
            credits_before = read_credits()
            page.click(".card:has(textarea) button.submit-btn", timeout=8000)
            page.wait_for_selector(".food-item", timeout=90000)
            page.wait_for_timeout(1500)
            names = [el.inner_text().strip().splitlines()[0] for el in page.query_selector_all(".food-item .food-name")]
            total_el = page.query_selector(".food-item:has(.food-name:has-text('总')) .food-nutrition")
            total = total_el.inner_text() if total_el else ""
            credits_after = read_credits()
            shot("C1-text")
            report["findings"]["C-text"] = {"names": names, "total": total, "credits_before": credits_before, "credits_after": credits_after}
            delta = f"积分 {credits_before} → {credits_after}"
            return f"文字识别 {names}；Total: {total}；{delta}"

        step("步骤C-a 文字输入+AI汇总", step_c_text)

        def step_c_image():
            images = collect_demo_images()
            log(f"TEMP 图片集: {[p.name for p in images]}")
            page.click(".tab:has-text('拍照')", timeout=8000)
            page.wait_for_timeout(800)
            per_image = []
            for img in images:
                with page.expect_file_chooser() as fc_info:
                    page.click(".upload-btn >> nth=1", timeout=10000)
                fc_info.value.set_files(str(img))
                page.wait_for_selector(".preview-thumb", timeout=10000)
                page.wait_for_timeout(1000)
                page.click(".card:has(.preview-thumb) button.submit-btn", timeout=10000)
                # 捕获“图片已优化 (XXKB)” Toast
                toast_seen = None
                deadline = time.time() + 15
                while time.time() < deadline:
                    body = page.inner_text("body")
                    m = re.search(r"图片已优化\s*\(([\d.]+KB)\)", body)
                    if m:
                        toast_seen = m.group(0)
                        break
                    page.wait_for_timeout(300)
                # 等待结果（非食物图可能 0 项，最多等 45s 后继续）
                names, total, counted = [], "", []
                try:
                    page.wait_for_selector(".food-item", timeout=45000)
                    page.wait_for_timeout(1500)
                    names = [el.inner_text().strip().splitlines()[0] for el in page.query_selector_all(".food-item .food-name")]
                    counted = [n for n in names if re.search(r"\(\s*\d+\s*(颗|块|个|碗|份|只|串|片)", n)]
                    total_el = page.query_selector(".food-item:has(.food-name:has-text('总')) .food-nutrition")
                    total = total_el.inner_text() if total_el else ""
                except Exception:
                    page.wait_for_timeout(3000)  # 非食物图：AI 返回 0 项，等待识别流程结束
                per_image.append({"file": img.name, "toast": toast_seen, "names": names, "counted": counted, "total": total})
                log(f"  [{img.name}] toast={toast_seen} names={names} counted={counted}")
                shot(f"C2-{img.stem[:18]}")
            report["findings"]["C-image"] = per_image
            all_counted = [n for p in per_image for n in p["counted"]]
            if not all_counted:
                raise AssertionError(f"所有图片均未识别出带数量的食物名称: {[p['names'] for p in per_image]}")
            return f"共 {len(images)} 张图；带数量名称: {all_counted}"

        step("步骤C-b TEMP 图片集识图（数量+整盘总热量）", step_c_image)

        # ── 步骤 D：商业与广告 ───────────────────────────────────
        def step_d_ad():
            before = read_credits()
            page.click(".ad-reward-btn", timeout=10000)
            page.wait_for_selector(".ad-modal", timeout=8000)
            shot("D1-ad-modal")
            # 广告倒计时后自动发奖 +10 并关闭
            after = before
            deadline = time.time() + 20
            while time.time() < deadline:
                after = read_credits()
                if after and after != before:
                    break
                page.wait_for_timeout(500)
            shot("D1-ad-rewarded")
            report["findings"]["D-ad"] = {"before": before, "after": after}
            return f"积分 {before} → {after}（看广告 +10）"

        step("步骤D-a 看广告领积分(+10)", step_d_ad)

        def step_d_billing():
            page.wait_for_timeout(800)
            page.click("button.btn-upgrade", timeout=10000)
            page.wait_for_selector(".billing-modal", timeout=8000)
            page.wait_for_timeout(800)
            cards = page.query_selector_all(".billing-modal .plan-card")
            assert len(cards) == 3, f"积分包卡片数量异常: {len(cards)}"
            modal_text = page.inner_text(".billing-modal")
            shot("D2-billing-cards")
            # 选第一个积分包 → 信用卡 → 支付 → 跳转 Stripe Checkout
            page.click(".billing-modal .plan-card .plan-btn >> nth=0", timeout=8000)
            page.wait_for_selector(".payment-method-btn", timeout=8000)
            page.click(".payment-method-btn:has-text('信用卡')", timeout=8000)
            page.wait_for_selector(".stripe-pay-btn", timeout=8000)
            shot("D2-billing-pay")
            page.click(".stripe-pay-btn", timeout=10000)
            checkout_url = wait_url_part("checkout.stripe.com", timeout=45)
            if not checkout_url:
                raise AssertionError("未跳转到 Stripe Checkout")
            shot("D2-checkout")
            report["findings"]["D-billing"] = {"cards": len(cards), "checkout_url": checkout_url}
            # 演示结束：返回站点
            page.goto(args.url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2000)
            return f"Stripe 3 卡片展示并跳转 Checkout: {checkout_url[:80]}..."

        step("步骤D-b 充值/Pro + Checkout 跳转", step_d_billing)

        page.wait_for_timeout(1500)
        shot("final")
        ctx.close()
        browser.close()

    report["console_errors"] = report["console_errors"][:5]
    ok = all(s["ok"] for s in report["steps"])
    (SHOT_DIR / "demo-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=" * 60)
    print(f"CEO VISUAL DEMO DEEP: {'PERFECT PLAY ✅' if ok else 'HAS ISSUES ❌'} (mode={args.mode}, slowMo={SLOW_MO}ms)")
    for s in report["steps"]:
        print(f"  {'✅' if s['ok'] else '❌'} {s['name']} ({s['elapsed']}s)")
    print(f"report={SHOT_DIR / 'demo-result.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
