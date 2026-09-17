package com.omerta.agent;

import android.content.Context;
import android.util.Log;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import org.json.JSONObject;

/**
 * Owns the embedded Python interpreter and the in-process agent backend.
 *
 * Chaquopy boots a full CPython inside this app. We extract the agent payload,
 * start `core.httpd` on a loopback port via the omerta_boot module, and cache
 * the port so the WebView can point at http://127.0.0.1:<port>/. Loopback is
 * exempt from the token gate, so the UI needs no credential to talk to its own
 * backend; other devices on the LAN still need the token.
 */
final class OmertaPython {

    private static final String TAG = "OmertaPython";
    static final int PORT = 8787;

    private static volatile boolean starting = false;
    private static volatile boolean ready = false;
    private static volatile int port = PORT;
    private static String homeDir;

    private OmertaPython() {}

    static synchronized void ensureStarted(Context ctx) {
        if (ready || starting) return;
        starting = true;
        Context app = ctx.getApplicationContext();
        try {
            if (!Python.isStarted()) {
                Python.start(new AndroidPlatform(app));
            }
            homeDir = OmertaAssets.ensure(app);
            String filesDir = app.getFilesDir().getAbsolutePath();
            // The only directory this app is allowed to execute from. Python
            // cannot work it out for itself -- it is assigned per install --
            // so it is passed in rather than guessed at.
            String nativeLibDir = app.getApplicationInfo().nativeLibraryDir;
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
            Log.i(TAG, "agent backend up on 127.0.0.1:" + port);
        } catch (Throwable t) {
            Log.e(TAG, "failed to start embedded backend", t);
            ready = false;
        } finally {
            starting = false;
        }
    }

    /** Persist an API key / local-model host without going through the server. */
    static boolean putSecret(Context ctx, String key, String value) {
        Context app = ctx.getApplicationContext();
        try {
            if (!Python.isStarted()) Python.start(new AndroidPlatform(app));
            if (homeDir == null) homeDir = OmertaAssets.ensure(app);
            String filesDir = app.getFilesDir().getAbsolutePath();
            PyObject boot = Python.getInstance().getModule("omerta_boot");
            boot.callAttr("put_secret", filesDir, homeDir, key, value);
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "put_secret failed", t);
            return false;
        }
    }

    static boolean isReady() { return ready; }

    static int port() { return port; }

    static String baseUrl() { return "http://127.0.0.1:" + port + "/"; }
}
