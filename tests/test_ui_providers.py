#!/usr/bin/env python3
"""The provider picker tells you why, and what to do about it.

This exists because of what the app showed on a real phone: every provider,
including the on-device one that needs no API key, listed as
"omerta — unavailable". The backend had already worked out the reason -- no
.gguf on the device -- and the UI discarded it, so three completely different
problems (no API key, no model downloaded, not built into this APK) all
presented as the same four words, each with a different fix.

So: the reason has to reach the screen, and an unavailable provider that CAN
be fixed has to offer the action. The reason is also looked up at click time
rather than baked into an onclick attribute, because a reason coming from an
exception can contain a quote and would otherwise break the handler; a hostile
reason is exercised here for that.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

fails = []


def check(label, cond):
    print(f"  {'✓' if cond else '✗'} {label}")
    if not cond:
        fails.append(label)


STATUS = {
    "providers": {
        "claude":   {"label": "claude", "model": "m", "ready": False,
                     "why": "no key in $ANTHROPIC_API_KEY"},
        "omerta":   {"label": "omerta", "model": "m", "ready": False,
                     "why": "no .gguf model on the device yet"},
        "ollama":   {"label": "ollama", "model": "m", "ready": False,
                     "why": "not running at http://127.0.0.1:11434"},
        "groq":     {"label": "groq", "model": "m", "ready": True, "why": ""},
        # a reason that would escape a quoted onclick attribute
        "evil":     {"label": "evil", "model": "m", "ready": False,
                     "why": "no key in $X'); alert('xss"},
    },
}


def main():
    print("=== provider reasons ===")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  playwright not installed — skipping (not a failure)")
        return 0

    html = (ROOT / "webui" / "index.html").read_text()
    with sync_playwright() as pw:
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
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.set_content(html)

        # The settings view is hidden until selected, and its loaders talk to
        # a backend that is not running here. Show the view and stub the
        # loaders so the test exercises the rendering and the handlers rather
        # than the network.
        page.evaluate("""() => {
            document.querySelectorAll('.view').forEach(e => e.classList.remove('on'));
            document.getElementById('v-settings').classList.add('on');
            window.loadStatus = window.loadSettings = window.loadSecrets =
                window.loadTheme = window.loadModels = window.loadLocalai =
                async () => {};
            window.localaiStart = async () => { window.__started = true; };
        }""")

        # Render just the provider list the way loadStatus() does.
        page.evaluate("""(st) => {
            PROVIDERS = st.providers;
            document.getElementById('providers').innerHTML =
              Object.entries(st.providers).map(([k, v]) => {
                const fix = providerFix(v);
                return `<div class="row"><span class="grow">${esc(k)}` +
                  (v.ready ? '' : `<span class="tiny"> — ${esc(v.why || 'unavailable')}</span>`) +
                  (fix ? ` <a href="#" onclick="providerAct('${esc(k)}');return false">${esc(fix.label)}</a>` : '') +
                  `</span><span>${v.ready ? '●' : '○'}</span></div>`;
              }).join('');
            const sel = document.getElementById('providerSel');
            sel.innerHTML = '<option value="auto">auto (best available)</option>' +
              Object.entries(st.providers).map(([k, v]) =>
                `<option value="${esc(k)}">${esc(k)} — ${esc(v.ready ? 'ready' : (v.why || 'unavailable'))}</option>`).join('');
        }""", STATUS)

        box = page.locator("#providers").inner_text()
        check("the on-device reason is shown, not just 'unavailable'",
              "no .gguf model on the device yet" in box)
        check("the missing-key reason names the variable",
              "$ANTHROPIC_API_KEY" in box)
        check("the local-server reason names the address",
              "127.0.0.1:11434" in box)

        picker = page.locator("#providerSel").inner_text()
        check("the picker shows the reason too",
              "no .gguf model on the device yet" in picker)
        check("a ready provider still reads 'ready'", "groq — ready" in picker)
        check("no provider is left as a bare 'unavailable'",
              "— unavailable" not in picker)

        # the actions
        check("the on-device provider offers a way to get a model",
              page.locator("#providers a", has_text="get a model").count() == 1)
        check("a keyless cloud provider offers a way to add a key",
              page.locator("#providers a", has_text="add a key").count() >= 1)
        check("an unreachable local server offers a way to set its address",
              page.locator("#providers a", has_text="set address").count() == 1)
        check("a ready provider offers no fix",
              "groq" in box and page.locator("#providers a").count() == 4)

        # clicking must reach the on-device section, not throw
        page.locator("#providers a", has_text="get a model").first.click()
        page.wait_for_timeout(250)
        check("'get a model' opens Settings",
              page.locator("#v-settings.on").count() == 1)

        # The hostile reason must be inert. Errors collected so far are page
        # boot noise -- set_content gives the page no base URL, so the app's
        # own startup fetches fail -- so only what the CLICK produces counts.
        errors.clear()
        page.locator("#providers a", has_text="add a key").last.click()
        page.wait_for_timeout(300)
        handler_errors = [e for e in errors if "fetch" not in e and "URL" not in e]
        check("a reason containing a quote does not break the handler",
              not handler_errors)
        check("and is shown as text, not executed", "alert('xss" in box)

        browser.close()

    if fails:
        print(f"\n{len(fails)} FAILED")
        return 1
    print("\nPROVIDER UI TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
