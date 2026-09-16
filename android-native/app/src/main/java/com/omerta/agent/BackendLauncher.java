package com.omerta.agent;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Starts and probes the agent backend.
 *
 * The backend is a Python process with a real shell — it has to be, because
 * an APK sandbox cannot exec git/gradle/adb/fastboot (Android blocks
 * executing binaries from app-private storage since API 29). So instead of
 * embedding a crippled agent, this asks Termux to run it, via Termux's
 * RUN_COMMAND intent. The user never opens a terminal; they tap the icon.
 *
 * Requires, once:
 *   - Termux installed (same signature key as Termux:Boot etc.)
 *   - allow-external-apps=true in ~/.termux/termux.properties
 */
public class BackendLauncher {

    private static final String TAG = "OmertaBackend";
    public static final String TERMUX_PKG = "com.termux";
    private static final String RUN_COMMAND_SERVICE =
            "com.termux.app.RunCommandService";
    private static final String ACTION_RUN_COMMAND =
            "com.termux.RUN_COMMAND";
    private static final String EXTRA_COMMAND_PATH =
            "com.termux.RUN_COMMAND_PATH";
    private static final String EXTRA_ARGUMENTS =
            "com.termux.RUN_COMMAND_ARGUMENTS";
    private static final String EXTRA_BACKGROUND =
            "com.termux.RUN_COMMAND_BACKGROUND";
    private static final String EXTRA_SESSION_ACTION =
            "com.termux.RUN_COMMAND_SESSION_ACTION";
    private static final String EXTRA_WORKDIR =
            "com.termux.RUN_COMMAND_WORKDIR";

    private static final String PREFIX = "/data/data/com.termux/files/usr";
    private static final String HOME = "/data/data/com.termux/files/home";

    /** Is the backend already answering on this port? */
    public static boolean isUp(String hostPort, int timeoutMs) {
        HttpURLConnection c = null;
        try {
            URL u = new URL("http://" + hostPort + "/api/status");
            c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            // 401 still means something is listening and it's ours
            return code == 200 || code == 401;
        } catch (IOException e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    public static boolean termuxInstalled(Context ctx) {
        try {
            ctx.getPackageManager().getPackageInfo(TERMUX_PKG, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Ask Termux to start `omerta serve` in the background.
     * Returns false if the intent could not be dispatched at all.
     */
    public static boolean start(Context ctx, int port) {
        if (!termuxInstalled(ctx)) return false;
        try {
            Intent i = new Intent();
            i.setClassName(TERMUX_PKG, RUN_COMMAND_SERVICE);
            i.setAction(ACTION_RUN_COMMAND);
            // Run through login shell so ~/.bashrc exports (API key, sync dir)
            // are present — the agent reads its config from the environment.
            i.putExtra(EXTRA_COMMAND_PATH, PREFIX + "/bin/bash");
            i.putExtra(EXTRA_ARGUMENTS, new String[]{
                    "-lc",
                    "export OMERTA_PORT=" + port + "; "
                            + "pgrep -f 'omerta serve' >/dev/null && exit 0; "
                            + "exec " + PREFIX + "/bin/omerta serve"
            });
            i.putExtra(EXTRA_WORKDIR, HOME);
            i.putExtra(EXTRA_BACKGROUND, true);
            i.putExtra(EXTRA_SESSION_ACTION, "0");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
            return true;
        } catch (SecurityException e) {
            Log.w(TAG, "RUN_COMMAND refused — allow-external-apps not set?", e);
            return false;
        } catch (Exception e) {
            Log.w(TAG, "could not start backend", e);
            return false;
        }
    }

    /** Open Termux itself, for the one-time setup case. */
    public static void openTermux(Context ctx) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(TERMUX_PKG);
        if (i != null) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } else {
            ctx.startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://f-droid.org/packages/com.termux/"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
    }
}
