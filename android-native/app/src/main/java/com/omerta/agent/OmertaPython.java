package com.omerta.agent;

import android.content.Context;
import android.util.Log;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import org.json.JSONObject;

import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Owns the embedded Python interpreter and the in-process agent backend.
 *
 * Chaquopy boots a full CPython inside this app. We extract the agent payload,
 * start `core.httpd` on a loopback port via the omerta_boot module, and cache
 * the port so the WebView can point at http://127.0.0.1:<port>/. Loopback is
 * exempt from the token gate, so the UI needs no credential to talk to its own
 * backend; other devices on the LAN still need the token.
 *
 * When the backend fails to start we keep the reason. An earlier version only
 * logged it, which meant a one-line signature mismatch presented to the user
 * as an unexplained "backend didn't come up" for four releases. The failure is
 * now reportable from the device itself, with no cable and no logcat.
 */
final class OmertaPython {

    private static final String TAG = "OmertaPython";
    static final int PORT = 8787;

    private static volatile boolean starting = false;
    private static volatile boolean ready = false;
    private static volatile int port = PORT;
    private static volatile String lastError = null;
    private static String homeDir;
    private static String nativeLibDir;
    private static String filesDir;

    private OmertaPython() {}

    static synchronized void ensureStarted(Context ctx) {
        if (ready || starting) return;
        starting = true;
        // Stale from a previous attempt: the launch screen treats a non-null
        // error as "stop waiting", so leaving the old one in place would make
        // every retry fail instantly with the first failure's message.
        lastError = null;
        Context app = ctx.getApplicationContext();
        try {
            if (!Python.isStarted()) {
                Python.start(new AndroidPlatform(app));
            }
            homeDir = OmertaAssets.ensure(app);
            filesDir = app.getFilesDir().getAbsolutePath();
            // The only directory this app is allowed to execute from. Python
            // cannot work it out for itself -- it is assigned per install --
            // so it is passed in rather than guessed at.
            nativeLibDir = app.getApplicationInfo().nativeLibraryDir;
            Python py = Python.getInstance();
            PyObject boot = py.getModule("omerta_boot");
            String res = boot.callAttr("start", filesDir, homeDir, PORT,
                                       nativeLibDir).toString();
            try {
                JSONObject j = new JSONObject(res);
                port = j.optInt("port", PORT);
            } catch (Exception ignore) {
                port = PORT;
            }
            ready = true;
            lastError = null;
            Log.i(TAG, "agent backend up on 127.0.0.1:" + port);
        } catch (Throwable t) {
            lastError = describe(t);
            Log.e(TAG, "failed to start embedded backend", t);
            ready = false;
        } finally {
            starting = false;
        }
    }

    /** One-line reason the backend failed, or null if it has not failed. */
    static String lastError() { return lastError; }

    /** Clear the last failure before a deliberate retry.
     *
     *  Called from the UI thread BEFORE the service thread runs, so the launch
     *  screen cannot observe the previous attempt's error and give up during
     *  the window before ensureStarted() clears it itself. */
    static void clearError() { lastError = null; }

    /**
     * Full launch-failure evidence, gathered on the device. Safe to call from
     * a background thread only -- it re-runs the start path.
     */
    static String diagnostics(Context ctx) {
        StringBuilder sb = new StringBuilder();
        sb.append("OMERTA AI diagnostics\n");
        try {
            Context app = ctx.getApplicationContext();
            sb.append("abi: ").append(android.os.Build.SUPPORTED_ABIS.length > 0
                    ? android.os.Build.SUPPORTED_ABIS[0] : "?").append('\n');
            sb.append("device: ").append(android.os.Build.MANUFACTURER)
              .append(' ').append(android.os.Build.MODEL)
              .append(" (sdk ").append(android.os.Build.VERSION.SDK_INT).append(")\n");
            try {
                android.content.pm.PackageInfo pi = app.getPackageManager()
                        .getPackageInfo(app.getPackageName(), 0);
                sb.append("app: ").append(pi.versionName)
                  .append(" (").append(pi.versionCode).append(")\n");
            } catch (Throwable ignore) {
                sb.append("app: unknown\n");
            }
            sb.append("last error: ").append(lastError == null ? "(none)" : lastError)
              .append("\n\n");

            if (!Python.isStarted()) Python.start(new AndroidPlatform(app));
            String home = homeDir != null ? homeDir : OmertaAssets.ensure(app);
            String files = filesDir != null ? filesDir
                    : app.getFilesDir().getAbsolutePath();
            String natives = nativeLibDir != null ? nativeLibDir
                    : app.getApplicationInfo().nativeLibraryDir;
            PyObject boot = Python.getInstance().getModule("omerta_boot");
            sb.append(boot.callAttr("diagnose", files, home, natives).toString());
        } catch (Throwable t) {
            sb.append("diagnostics failed:\n").append(describe(t));
        }
        return sb.toString();
    }

    /** Persist an API key / local-model host without going through the server. */
    static boolean putSecret(Context ctx, String key, String value) {
        Context app = ctx.getApplicationContext();
        try {
            if (!Python.isStarted()) Python.start(new AndroidPlatform(app));
            if (homeDir == null) homeDir = OmertaAssets.ensure(app);
            String files = app.getFilesDir().getAbsolutePath();
            PyObject boot = Python.getInstance().getModule("omerta_boot");
            boot.callAttr("put_secret", files, homeDir, key, value);
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "put_secret failed", t);
            return false;
        }
    }

    private static String describe(Throwable t) {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        String full = sw.toString();
        // Chaquopy wraps Python exceptions; the first line carries the type
        // and message, which is the part worth putting on screen.
        int nl = full.indexOf('\n');
        String head = nl > 0 ? full.substring(0, nl) : full;
        return head.trim();
    }

    static boolean isReady() { return ready; }

    static int port() { return port; }

    static String baseUrl() { return "http://127.0.0.1:" + port + "/"; }
}
