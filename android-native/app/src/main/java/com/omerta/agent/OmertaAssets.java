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
        copyAssetDir(ctx.getAssets(), ASSET_ROOT, home);
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
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        }
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
