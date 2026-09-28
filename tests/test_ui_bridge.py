#!/usr/bin/env python3
"""The UI talks to Python in-process, with nothing on the wire.

The app used to reach its own backend over HTTP on 127.0.0.1. That made the
whole UI depend on a socket binding, a port being free and a server thread
staying up -- and every failure of that machinery reached the user as "backend
didn't come up" while the agent itself was fine. The page now calls Python
directly through a JavaScript interface.

What this pins, in a real browser with a stubbed interface:
  * get() and post() go through the bridge when it exists, and over HTTP when
    it does not, so one code path serves the app and the desktop.
  * the call is ASYNCHRONOUS. The synchronous form blocks the JavaScript
    thread, and a chat turn can take a minute -- an app frozen with no spinner.
  * a 404 or a 500 arrives as data the page renders, not as an exception,
    matching what fetch() does.
  * uploads are chunked, so a large file is never assembled in memory. That is
    the entire reason attachments have no size limit.
"""
import glob
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

fails = []


def check(label, cond, detail=""):
    print(f"  {'✓' if cond else '✗'} {label}" + (f"  {detail}" if not cond else ""))
    if not cond:
        fails.append(label)


def main():
    print("=== in-process UI bridge ===")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  playwright not installed — skipping (not a failure)")
        return 0

    html = (ROOT / "webui" / "index.html").read_text(encoding="utf-8")
    with sync_playwright() as pw:
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

        # The stub has to exist BEFORE the page's own script runs, because
        # NATIVE is captured once at load -- which is exactly how Android
        # provides it (addJavascriptInterface is in place before the page is
        # given a URL). Injecting into <head> is what guarantees that ordering;
        # add_init_script does not fire for set_content.
        STUB = """
        window.__calls = [];
        window.__chunks = [];
        window.__httpUsed = false;
        // Any fetch at all would mean the bridge was bypassed.
        window.fetch = function(){ window.__httpUsed = true;
                                   return Promise.reject(new Error('no HTTP here')); };
        window.OmertaNative = {
          callAsync: function(id, method, path, body){
            window.__calls.push({id:id, method:method, path:path, body:body});
            // Reply on a later tick, the way a worker thread does. If the page
            // resolved synchronously this test would pass even for a blocking
            // implementation.
            setTimeout(function(){
              var env;
              if(path.indexOf('/api/nope') === 0)      env = {status:404, body:{error:'no route'}};
              else if(path.indexOf('/api/boom') === 0) env = {status:500, body:{}};
              else env = {status:200, body:{ok:true, saw:method+' '+path,
                                            sent:body||''}};
              window.__omertaResolve(id, JSON.stringify(env));
            }, 5);
          },
          attachBegin: function(name, project, note){
            window.__chunks = [];
            window.__begin = {name:name, project:project, note:note};
            return JSON.stringify({id:'up1'});
          },
          attachChunk: function(id, b64){
            window.__chunks.push(b64.length);
            return JSON.stringify({written: window.__chunks.length});
          },
          attachEnd: function(id, size){
            return JSON.stringify({id:'att1', name:window.__begin.name,
                                   bytes: Number(size)});
          },
          attachAbort: function(id){ window.__aborted = true; return '{}'; },
          ready: function(){ return true; },
          lastError: function(){ return ''; }
        };
        """
        page.set_content(html.replace("<head>",
                                      "<head>\n<script>" + STUB + "</script>", 1))

        check("the page detects the native bridge",
              page.evaluate("() => !!NATIVE") is True)

        # ── GET / POST through the bridge ──────────────────────────────────
        got = page.evaluate("async () => await get('/api/status')")
        check("get() is answered through the bridge",
              got.get("ok") is True and got.get("saw") == "GET /api/status", got)

        posted = page.evaluate(
            "async () => await post('/api/chat', {text:'hello'})")
        check("post() is answered through the bridge",
              posted.get("saw") == "POST /api/chat", posted)
        check("and the body is carried as JSON",
              json.loads(posted.get("sent") or "{}").get("text") == "hello",
              posted.get("sent"))

        calls = page.evaluate("() => window.__calls")
        # The page's own startup already went through the bridge before this
        # test called anything, which is the point: the WHOLE UI is on it, not
        # just the two requests made here.
        check("the page's own startup goes through the bridge too",
              len(calls) > 2, calls)
        check("both test requests went through callAsync, not a sync form",
              {"GET /api/status", "POST /api/chat"}
              <= {c["method"] + " " + c["path"] for c in calls}, calls)
        check("every call carries a distinct id",
              len({c["id"] for c in calls}) == len(calls), calls)
        check("nothing was sent over HTTP",
              page.evaluate("() => window.__httpUsed || false") is False)

        # ── the call really is asynchronous ────────────────────────────────
        ordering = page.evaluate("""async () => {
            const marks = [];
            const p = get('/api/status').then(()=>marks.push('reply'));
            marks.push('after-call');     // must run BEFORE the reply lands
            await p;
            return marks;
        }""")
        check("the page keeps running while the backend works",
              ordering == ["after-call", "reply"], ordering)

        # ── failures arrive as data ────────────────────────────────────────
        nf = page.evaluate("async () => await get('/api/nope')")
        check("a 404 resolves with its error rather than throwing",
              nf.get("error") == "no route", nf)
        boom = page.evaluate("async () => await get('/api/boom')")
        check("a 500 with no message still names the status",
              boom.get("error") == "HTTP 500", boom)

        # ── uploads are chunked ────────────────────────────────────────────
        up = page.evaluate("""async () => {
            // 1.3 MiB: more than two 512 KiB slices, so chunking is exercised
            const size = 1300000;
            const f = new File([new Uint8Array(size)], 'big.bin');
            const r = await nativeUpload(f, '1 of 1', null);
            return {r:r, chunks: window.__chunks.length, size:size};
        }""")
        check("a large file is sent in several slices",
              up["chunks"] == 3, up)
        check("the upload reports the full size",
              up["r"].get("bytes") == up["size"], up["r"])
        check("and the filename survives", up["r"].get("name") == "big.bin", up["r"])

        # ── without the bridge, nothing changes for the desktop ────────────
        page2 = browser.new_page()
        page2.set_content(html)
        check("with no bridge the page falls back to HTTP",
              page2.evaluate("() => NATIVE") is None)

        browser.close()

    if fails:
        print(f"\n{len(fails)} FAILED")
        return 1
    print("\nUI BRIDGE TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
