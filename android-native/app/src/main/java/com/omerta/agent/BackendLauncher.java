package com.omerta.agent;

import android.content.Context;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Starts and probes the agent backend.
 *
 * The backend now runs INSIDE this app: Chaquopy hosts a full CPython, and
 * BackendService keeps `core.httpd` alive on loopback. No Termux, no external
 * process, nothing for the user to install. This class just kicks off the
 * service and lets callers poll until the server answers.
 */
public class BackendLauncher {

    private BackendLauncher() {}

    /** Start the embedded backend (idempotent). */
    public static void start(Context ctx) {
        BackendService.startService(ctx.getApplicationContext());
    }

    /** Is the backend answering on this host:port yet? */
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
}
