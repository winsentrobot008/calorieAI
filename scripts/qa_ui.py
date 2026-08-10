# -*- coding: utf-8 -*-
"""
qa_ui.py — CalorieAI 交付前 UI 质检（npm run qa:ui）

检查项：
  1. 无 TTS 测试残留（Tab / 页面文本）；
  2. 主页 Tab 数量 = 3（记录饮食 / 数据看板 / 个人设置）；
  3. 非管理员（普通用户 / Pro 用户）DOM 中不存在 .admin-entry 按钮；
  4. 购买弹窗为 Credits Top-up 积分包（无订阅 Tab、无月付/年付）；
  5. 多语言 zh/en × 明暗主题切换：0 console 报错、无横向溢出；
  6. 语义级 API 校验：随机输入调用 analyze-text，断言 200 + 模型标记 + 动态变更 + 反 Mock
     （禁止仅断言 200；命中固定 Mock 白米饭/鸡胸肉/西兰花直接 FAIL）。

若目标端口未启动，自动以生产构建（next start）拉起，测试后关闭。
用法：
  npm run qa:ui
  python scripts/qa_ui.py --url http://127.0.0.1:3100 --headed
"""

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 3100

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

result = {
    "checks": [],
    "console_errors": [],
    "network_errors": [],
    "tts_remnants": [],
    "layout_issues": [],
    "screenshots": [],
}


def log_check(name, ok, detail=""):
    result["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} - {name} {detail}")


def wait_ready(url, timeout=90):
    import urllib.request

    for _ in range(timeout):
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def main():
    parser = argparse.ArgumentParser(description="CalorieAI UI QA")
    parser.add_argument("--url", default=f"http://127.0.0.1:{PORT}")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--no-start", action="store_true", help="不自动启动服务器")
    parser.add_argument("--no-semantic", action="store_true", help="跳过语义级 API 校验（不推荐）")
    args = parser.parse_args()

    from playwright.sync_api import sync_playwright

    server = None
    started_here = False
    if not wait_ready(args.url, timeout=5):
        if args.no_start:
            print(f"❌ {args.url} 不可达（--no-start）")
            return 1
        print(f"[qa_ui] 目标未启动，拉起 next start -p {PORT} ...")
        server = subprocess.Popen(
            ["npm", "run", "start", "--", "-p", str(PORT), "-H", "127.0.0.1"],
            cwd=str(ROOT),
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        started_here = True
        if not wait_ready(args.url):
            print("❌ 服务器启动超时")
            return 1

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=not args.headed)
            page = browser.new_page(viewport={"width": 1280, "height": 800})

            def on_console(msg):
                if msg.type == "error":
                    result["console_errors"].append(msg.text)

            def on_response(resp):
                if resp.status >= 400:
                    result["network_errors"].append(f"{resp.status} {resp.url}")

            page.on("console", on_console)
            page.on("response", on_response)
            page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1200)

            shot_dir = ROOT / "qa-logs"
            shot_dir.mkdir(parents=True, exist_ok=True)

            # 1) TTS 残留
            body_text = page.inner_text("body")
            tts_hits = [kw for kw in ["TTS", "Edge-TTS", "tts", "朗读", "speak"] if kw in body_text]
            if tts_hits:
                result["tts_remnants"] = tts_hits
            log_check("无 TTS 测试残留", not tts_hits, f"hits={tts_hits}")

            # 2) Tab 数量
            tabs = [el.inner_text().strip() for el in page.query_selector_all("nav.tab-bar button")]
            log_check("主页 Tab = 3（记录饮食/数据看板/个人设置）", len(tabs) == 3, f"tabs={tabs}")

            # 3) 非管理员无管理按钮（普通用户 + Pro 用户）
            admin_btns = page.query_selector_all(".admin-entry")
            log_check("非管理员 DOM 无 .admin-entry 按钮", len(admin_btns) == 0, f"count={len(admin_btns)}")
            page.evaluate("""() => {
                localStorage.setItem("user_email", "normal@user.com");
                localStorage.setItem("user_pro", "true");
            }""")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(1000)
            admin_btns = page.query_selector_all(".admin-entry")
            log_check("Pro 普通用户 DOM 仍无 .admin-entry 按钮", len(admin_btns) == 0, f"count={len(admin_btns)}")
            page.evaluate("localStorage.removeItem('user_pro'); localStorage.removeItem('user_email');")

            # 4) 购买弹窗 = Credits Top-up 积分包（无订阅 Tab）
            page.click("button.btn-upgrade", timeout=5000)
            page.wait_for_timeout(600)
            modal = page.query_selector(".billing-modal")
            log_check("购买弹窗打开", modal is not None)
            if modal:
                pack_cards = page.query_selector_all(".billing-modal .plan-card")
                sub_tabs = page.query_selector_all(".billing-modal .billing-tab")
                modal_text = modal.inner_text()
                legacy = [kw for kw in ["月付", "年付", "永久买断"] if kw in modal_text]
                log_check("积分包卡片 = 3", len(pack_cards) == 3, f"count={len(pack_cards)}")
                log_check("无订阅/买断 Tab", len(sub_tabs) == 0 and not legacy, f"legacy={legacy}")
                page.screenshot(path=str(shot_dir / f"qa-ui-billing-{int(time.time())}.png"))
            page.click(".billing-modal .modal-close", timeout=5000)

            # 5) 多语言 × 明暗主题
            def toggle_theme():
                page.click("header button.rounded-full", timeout=5000)
                page.wait_for_timeout(400)

            for locale in ["zh", "en"]:
                locale_label = "中文" if locale == "zh" else "EN"
                page.click(f".locale-switcher button:has-text('{locale_label}')", timeout=5000)
                page.wait_for_timeout(400)
                if not page.evaluate("() => document.documentElement.classList.contains('dark')"):
                    toggle_theme()
                layout = page.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
                if layout["sw"] > layout["cw"] + 2:
                    result["layout_issues"].append(f"locale={locale} dark overflow {layout}")
                log_check(f"locale={locale} dark 无报错/无溢出", not result["console_errors"] and layout["sw"] <= layout["cw"] + 2, str(layout))
                toggle_theme()
                layout = page.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
                if layout["sw"] > layout["cw"] + 2:
                    result["layout_issues"].append(f"locale={locale} light overflow {layout}")
                log_check(f"locale={locale} light 无报错/无溢出", not result["console_errors"] and layout["sw"] <= layout["cw"] + 2, str(layout))

            # 6) 语义级 API 校验：随机输入 + 模型标记 + 动态变更 + 反 Mock
            if not args.no_semantic:
                import random as _random

                def _sig(records):
                    return "~".join(
                        f"{r.get('food', '')}|{r.get('grams', 0)}|{r.get('calories', 0)}" for r in (records or [])
                    )

                legacy_sig = "~".join(["白米饭|200|260", "鸡胸肉|150|247", "西兰花|100|34"])
                browser_ua = (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
                )
                texts = [
                    f"吃了{_random.randint(120, 220)}g米饭和{_random.randint(60, 140)}g西兰花（QA语义随机 {int(time.time())}）",
                    f"早餐{_random.choice(['一杯牛奶', '两个鸡蛋', '一碗燕麦'])}（QA语义随机 {int(time.time())}）",
                ]
                sigs = []
                for i, txt in enumerate(texts, 1):
                    try:
                        resp = page.request.post(
                            f"{args.url}/api/v1/meals/analyze-text",
                            data=json.dumps({"text": txt, "meal_type": "lunch"}),
                            headers={"Content-Type": "application/json", "User-Agent": browser_ua},
                        )
                        data = resp.json()
                        records = data.get("records") or []
                        sig = _sig(records)
                        sigs.append(sig)
                        ok = (
                            resp.ok
                            and isinstance(data.get("model", {}).get("provider"), str)
                            and len(records) > 0
                            and sig != legacy_sig
                        )
                        log_check(
                            f"analyze-text 语义[{i}] 200+模型标记+反Mock",
                            ok,
                            f"status={resp.status} provider={data.get('model', {}).get('provider', '-')} count={len(records)}",
                        )
                    except Exception as e:
                        log_check(f"analyze-text 语义[{i}]", False, f"ERROR: {e}")
                if len(sigs) == 2:
                    log_check(
                        "analyze-text 动态变更（两次随机输入结果不同）",
                        sigs[0] != sigs[1],
                        "records 签名不同" if sigs[0] != sigs[1] else "两次返回相同 records（疑似静态 Mock）",
                    )

            shot = shot_dir / f"qa-ui-home-{int(time.time())}.png"
            page.screenshot(path=str(shot))
            result["screenshots"].append(str(shot))
            browser.close()
    finally:
        if started_here and server:
            server.terminate()
            try:
                server.wait(timeout=10)
            except Exception:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(server.pid), "/T", "/F"], capture_output=True)

    ok = (
        not result["console_errors"]
        and not result["network_errors"]
        and not result["tts_remnants"]
        and not result["layout_issues"]
        and all(c["ok"] for c in result["checks"])
    )
    (ROOT / "qa-logs" / "qa-ui-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("=" * 60)
    print(f"QA UI RESULT: {'ALL PASS' if ok else 'FAIL'}")
    print(f"console_errors={len(result['console_errors'])} network_errors={len(result['network_errors'])}")
    print(f"report={ROOT / 'qa-logs' / 'qa-ui-result.json'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
