package com.omerta.agent;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Extracts the bundled agent payload (Python code + web UI + skills, staged
 * into assets/omerta_payload at build time) into the app's private files dir.
 *
 * Python can import .py from a real directory but not directly from the APK's
 * asset store, and the server reads the web UI / persona as ordinary files, so
 * the payload has to live on disk. We extract once per app version: a marker
 * file records the version that was unpacked, and we only re-extract when it
 * changes (i.e. after an app update).
 */
final class OmertaAssets {

    private static final String TAG = "OmertaAssets";
    private static final String ASSET_ROOT = "omerta_payload";
    private static final String DIR_NAME = "omerta";
    private static final String MARKER = ".payload_version";

    /** Files written by the current extraction, for the launch screen.
     *
     *  The payload now carries a full Python stdlib -- thousands of small
     *  files -- and on a slow 32-bit phone that is minutes of work behind a
     *  splash screen that says only "starting". A counter costs nothing and
     *  turns "it has hung" into "it is on file 2,400". */
    private static volatile int written = 0;
    private static volatile boolean extracting = false;

    static int written() { return written; }

    static boolean extracting() { return extracting; }

    private OmertaAssets() {}

    /** Returns the absolute path of the ready-to-use payload directory. */
    static String ensure(Context ctx) throws IOException {
        File home = new File(ctx.getFilesDir(), DIR_NAME);
        String version = appVersion(ctx);
        File marker = new File(home, MARKER);

        if (home.isDirectory() && marker.isFile() && version.equals(read(marker))) {
            return home.getAbsolutePath();      // already current
        }

        // stale or missing — rebuild cleanly
        deleteRecursive(home);
        if (!home.mkdirs() && !home.isDirectory()) {
            throw new IOException("could not create " + home);
        }
        written = 0;
        extracting = true;
        try {
            copyAssetDir(ctx.getAssets(), ASSET_ROOT, home);
        } finally {
            extracting = false;
        }
        // The marker is written LAST and only on success. A half-extracted
        // payload that claimed to be complete would fail every later launch
        // in a way that looks like a code bug; without the marker the next
        // launch simply redoes the work.
        write(marker, version);
        Log.i(TAG, "extracted agent payload for version " + version);
        return home.getAbsolutePath();
    }

    private static String appVersion(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager()
                    .getPackageInfo(ctx.getPackageName(), 0);
            return pi.versionName + "." + pi.versionCode;
        } catch (Exception e) {
            return "unknown";
        }
    }

    private static void copyAssetDir(AssetManager am, String assetPath, File dest)
            throws IOException {
        String[] children = am.list(assetPath);
        if (children == null || children.length == 0) {
            copyAssetFile(am, assetPath, dest);     // it's a file
            return;
        }
        if (!dest.exists() && !dest.mkdirs() && !dest.isDirectory()) {
            throw new IOException("mkdir failed: " + dest);
        }
        for (String child : children) {
            copyAssetDir(am, assetPath + "/" + child, new File(dest, child));
        }
    }

    private static void copyAssetFile(AssetManager am, String assetPath, File dest)
            throws IOException {
        File parent = dest.getParentFile();
        if (parent != null && !parent.exists()) parent.mkdirs();
        try (InputStream in = am.open(assetPath);
             OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        }
        written++;
    }

    // ── serving the UI in-process ────────────────────────────────────────
    private static final java.util.Map<String, String> CTYPES =
            new java.util.HashMap<String, String>() {{
                put("html", "text/html"); put("css", "text/css");
                put("js", "text/javascript"); put("json", "application/json");
                put("svg", "image/svg+xml"); put("png", "image/png");
                put("jpg", "image/jpeg"); put("jpeg", "image/jpeg");
                put("gif", "image/gif"); put("webp", "image/webp");
                put("ico", "image/x-icon"); put("woff2", "font/woff2");
                put("ttf", "font/ttf");
            }};

    /**
     * Serve one request for the app's own UI, with nothing on the wire.
     *
     * Static files come straight off disk, which keeps the page loading even
     * while the interpreter is still warming up. Anything generated -- the
     * theme stylesheet and its images -- is asked of Python.
     *
     * Returns null when the path is not ours, which tells the WebView to
     * handle it normally (and, since nothing else resolves on this synthetic
     * origin, to fail).
     */
    static android.webkit.WebResourceResponse serve(Context ctx, String path) {
        if (path == null || path.isEmpty()) path = "/";
        try {
            if (path.equals("/theme.css") || path.startsWith("/theme/asset/")) {
                return fromPython(path);
            }
            File home = new File(ctx.getFilesDir(), DIR_NAME);
            File f;
            if (path.equals("/") || path.equals("/index.html")) {
                f = new File(new File(home, "webui"), "index.html");
            } else if (path.startsWith("/assets/")) {
                f = new File(new File(home, "assets"), path.substring(8));
            } else if (path.equals("/icon.svg") || path.equals("/favicon.ico")) {
                f = new File(new File(home, "assets"), path.substring(1));
            } else if (path.startsWith("/webui/")) {
                f = new File(new File(home, "webui"), path.substring(7));
            } else {
                return null;
            }
            // Refuse anything that climbed out of the payload. The path comes
            // from a page we wrote, but a served directory plus "../" is how
            // a UI bug turns into reading the whole filesystem.
            String root = home.getCanonicalPath() + File.separator;
            if (!f.getCanonicalPath().startsWith(root) || !f.isFile()) {
                return notFound();
            }
            return new android.webkit.WebResourceResponse(
                    ctypeOf(f.getName()), "utf-8", new java.io.FileInputStream(f));
        } catch (Throwable t) {
            Log.e(TAG, "serve failed for " + path, t);
            return notFound();
        }
    }

    private static android.webkit.WebResourceResponse fromPython(String path) {
        try {
            com.chaquo.python.PyObject boot =
                    com.chaquo.python.Python.getInstance().getModule("omerta_boot");
            String b64 = boot.callAttr("asset", OmertaPython.homeDir(), path)
                             .toString();
            int sep = b64.indexOf('|');
            if (sep < 0) return notFound();
            String ctype = b64.substring(0, sep);
            byte[] data = android.util.Base64.decode(b64.substring(sep + 1),
                                                     android.util.Base64.DEFAULT);
            return new android.webkit.WebResourceResponse(
                    ctype, "utf-8", new java.io.ByteArrayInputStream(data));
        } catch (Throwable t) {
            Log.e(TAG, "python asset failed for " + path, t);
            return notFound();
        }
    }

    private static android.webkit.WebResourceResponse notFound() {
        return new android.webkit.WebResourceResponse(
                "text/plain", "utf-8", 404, "Not Found",
                new java.util.HashMap<>(),
                new java.io.ByteArrayInputStream(new byte[0]));
    }

    private static String ctypeOf(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot < 0 ? "" : name.substring(dot + 1).toLowerCase();
        String c = CTYPES.get(ext);
        return c == null ? "application/octet-stream" : c;
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static String read(File f) {
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int off = 0, n;
            while (off < b.length && (n = in.read(b, off, b.length - off)) != -1) off += n;
            return new String(b, 0, off).trim();
        } catch (IOException e) {
            return "";
        }
    }

    private static void write(File f, String s) throws IOException {
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(s.getBytes());
        }
    }
}
