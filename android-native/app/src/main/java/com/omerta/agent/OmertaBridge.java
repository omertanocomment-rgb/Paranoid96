package com.omerta.agent;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;

/**
 * The web UI's way into the backend, with no network in between.
 *
 * The app used to run an HTTP server on loopback and point the WebView at
 * http://127.0.0.1:8787/. That meant the UI could only work if a socket bound,
 * a port was free and a server thread stayed up -- and every failure of that
 * machinery reached the user as "backend didn't come up", with the actual
 * agent sitting there perfectly healthy behind it.
 *
 * Now the page calls straight into Python. `call()` hands the request to
 * core/dispatch through Chaquopy and returns the reply as JSON. Same routes,
 * same approval gate; no listening socket on the device at all.
 *
 * Every method here runs on a WebView JavaScript thread, not the UI thread, so
 * blocking is fine and expected -- a chat turn can take a minute.
 *
 * SCOPE: this object is only reachable from the page WE load, on the synthetic
 * origin MainActivity serves. The WebView is not given access to arbitrary
 * sites, so no third-party page can reach it.
 */
final class OmertaBridge {

    private static final String TAG = "OmertaBridge";

    private final Context app;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    // One worker: requests from a single UI are naturally sequential, and a
    // pool would let a slow chat turn be overtaken by the status poll behind
    // it, which is how a UI ends up rendering stale state.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    OmertaBridge(Context ctx, WebView web) {
        this.app = ctx.getApplicationContext();
        this.web = web;
    }

    /**
     * Run a request off the JavaScript thread and hand the reply back through
     * `window.__omertaResolve(id, json)`.
     *
     * The synchronous `call()` below blocks until Python answers, and a chat
     * turn can take a minute -- on the JavaScript thread that is a frozen UI
     * with no spinner and no way to cancel. So the page awaits a promise and
     * this resolves it later.
     */
    @JavascriptInterface
    public void callAsync(final String id, final String method,
                          final String path, final String body) {
        worker.submit(() -> {
            final String out = call(method, path, body);
            main.post(() -> {
                if (web == null) return;
                web.evaluateJavascript(
                        "window.__omertaResolve(" + quote(id) + "," + quote(out) + ")",
                        null);
            });
        });
    }

    /**
     * One request. `method` is GET or POST, `path` includes the query string,
     * `body` is a JSON string or empty.
     *
     * Returns {"status":int,"body":object} as JSON. Never returns null and
     * never throws into JavaScript: a failure here has to arrive as something
     * the page can render, or the UI just hangs with no explanation.
     */
    @JavascriptInterface
    public String call(String method, String path, String body) {
        try {
            OmertaPython.ensureStarted(app);
            PyObject boot = Python.getInstance().getModule("omerta_boot");
            PyObject res = boot.callAttr("request", OmertaPython.homeDir(),
                                         method == null ? "GET" : method,
                                         path == null ? "/" : path,
                                         body == null ? "" : body);
            return res.toString();
        } catch (Throwable t) {
            Log.e(TAG, "bridge call failed: " + method + " " + path, t);
            return "{\"status\":500,\"body\":{\"error\":"
                    + quote(t.getClass().getSimpleName() + ": " + t.getMessage())
                    + "}}";
        }
    }

    /** Start an upload. Returns {"id":...} or {"error":...}. */
    @JavascriptInterface
    public String attachBegin(String name, String project, String note) {
        return py("attach_begin", name == null ? "file" : name,
                  project == null ? "" : project, note == null ? "" : note);
    }

    /** Append one base64 slice. Small enough that blocking here is brief. */
    @JavascriptInterface
    public String attachChunk(String uploadId, String b64) {
        return py("attach_chunk", uploadId, b64 == null ? "" : b64);
    }

    /** Finish and register the attachment. */
    @JavascriptInterface
    public String attachEnd(String uploadId, String declaredSize) {
        long n;
        try {
            n = Long.parseLong(declaredSize == null ? "0" : declaredSize);
        } catch (NumberFormatException e) {
            n = 0;
        }
        return py("attach_end", uploadId, String.valueOf(n));
    }

    /** Give up on a part-written upload and remove it. */
    @JavascriptInterface
    public String attachAbort(String uploadId) {
        return py("attach_abort", uploadId);
    }

    private String py(String fn, Object... args) {
        try {
            OmertaPython.ensureStarted(app);
            PyObject boot = Python.getInstance().getModule("omerta_boot");
            Object[] all = new Object[args.length + 1];
            all[0] = OmertaPython.homeDir();
            System.arraycopy(args, 0, all, 1, args.length);
            return boot.callAttr(fn, all).toString();
        } catch (Throwable t) {
            Log.e(TAG, "bridge " + fn + " failed", t);
            return "{\"error\":" + quote(t.getClass().getSimpleName()
                    + ": " + t.getMessage()) + "}";
        }
    }

    /** Is the backend up? Lets the page show a real reason when it is not. */
    @JavascriptInterface
    public boolean ready() {
        return OmertaPython.isReady();
    }

    /** Why the backend did not start, or empty. */
    @JavascriptInterface
    public String lastError() {
        String e = OmertaPython.lastError();
        return e == null ? "" : e;
    }

    private static String quote(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
