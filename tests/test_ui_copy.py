#!/usr/bin/env python3
"""Copy buttons in chat, driven through a real browser.

Clipboard behaviour cannot be verified by reading the code: it depends on
whether the page is a secure context, and the app is served over plain http on
loopback, where navigator.clipboard is unavailable in most browsers. So this
loads the actual page in Chromium with the clipboard API removed -- the
condition on the device -- and checks that copying still works.

The other thing under test is WHAT gets copied. The rendered message has been
HTML-escaped and had its markdown turned into tags, so copying the DOM would
hand back "&amp;" and "<b>" instead of what was actually said.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


TRICKY = "a & b < c > d \"quoted\" **bold** and `code`"
FENCED = "line one\n  indented & <tagged>\nline three"


def main():
    print("=== chat copy buttons ===")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  playwright not installed — skipping (not a failure)")
        return 0

    html = (ROOT / "webui" / "index.html").read_text()
    with sync_playwright() as pw:
        # The image pins a Chromium build that may not match what this
        # playwright expects, so the bundled binary is named explicitly rather
        # than letting the version lookup fail the whole suite.
        import glob
        browser = None
        for exe in sorted(glob.glob("/opt/pw-browsers/chromium-*/chrome-linux/chrome")
                          + glob.glob("/opt/pw-browsers/chromium_headless_shell-*/"
                                      "chrome-linux/headless_shell")) or [None]:
            try:
                browser = pw.chromium.launch(executable_path=exe) if exe \
                    else pw.chromium.launch()
                break
            except Exception:  # noqa: BLE001
                continue
        if browser is None:
            try:
                browser = pw.chromium.launch()
            except Exception as e:  # noqa: BLE001
                print(f"  no browser available ({type(e).__name__}) — skipping")
                return 0
        page = browser.new_page()
        page.set_content(html)

        # The device's condition: plain http, so no clipboard API at all.
        page.evaluate("""() => {
            try { delete window.navigator.clipboard; } catch (e) {}
            Object.defineProperty(window, 'isSecureContext',
                                  {value: false, configurable: true});
            window.__copied = null;
            document.execCommand = function (cmd) {
                if (cmd === 'copy') {
                    const el = document.activeElement;
                    window.__copied = el && el.value !== undefined ? el.value : '';
                    return true;
                }
                return false;
            };
        }""")

        page.evaluate("""([tricky, fenced]) => {
            window.log = document.getElementById('log')
                      || document.body.appendChild(document.createElement('div'));
            addMsg('you', tricky);
            addMsg('omerta', 'here you go:\\n```\\n' + fenced + '\\n```\\nthat is it');
        }""", [TRICKY, FENCED])

        msgs = page.locator(".msg")
        check("both messages rendered", msgs.count() == 2)
        check("every message has a copy button",
              page.locator(".msg .meta .copy").count() == 2)
        check("the fenced block has its own copy button",
              page.locator(".msg pre .copy").count() == 1)

        # message copy -> the ORIGINAL text, not the rendered DOM
        page.locator(".msg .meta .copy").first.click()
        got = page.evaluate("() => window.__copied")
        check("copying a message copies the raw text", got == TRICKY)
        check("copying does not hand back escaped HTML",
              got is not None and "&amp;" not in got and "&quot;" not in got)
        check("copying keeps the markdown as typed",
              got is not None and "**bold**" in got)

        # code copy -> exactly the code, no fences, no escaping
        page.locator(".msg pre .copy").first.click()
        code = page.evaluate("() => window.__copied")
        check("copying a block copies the code", code is not None
              and code.strip() == FENCED.strip())
        check("the copied block keeps its indentation",
              code is not None and "  indented" in code)
        check("the copied block is unescaped",
              code is not None and "<tagged>" in code)
        check("the copied block excludes the fence markers",
              code is not None and "```" not in code)

        # feedback, so a tap is visibly acknowledged
        page.locator(".msg .meta .copy").first.click()
        label = page.locator(".msg .meta .copy").first.inner_text()
        check("the button confirms it copied", label.strip().lower() == "copied")

        # and the button must not end up inside the copied text
        page.locator(".msg pre .copy").first.click()
        code2 = page.evaluate("() => window.__copied")
        check("the copy button is not itself copied",
              code2 is not None and "copy" not in code2.lower())

        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.evaluate("() => addMsg('omerta', 'plain message, no code')")
        check("a message with no code block still works",
              page.locator(".msg").count() == 3 and not errors)
        browser.close()

    print()
    if fails:
        print(f"UI COPY TESTS FAILED: {len(fails)}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("UI COPY TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
