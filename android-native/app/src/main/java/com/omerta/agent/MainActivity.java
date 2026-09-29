package com.omerta.agent;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import androidx.activity.ComponentActivity;

import com.omerta.agent.ui.Intake;

import java.util.ArrayList;
import java.util.List;

/**
 * OMERTA AGENT.
 *
 * The interface is Jetpack Compose -- real Android widgets. There is no
 * WebView, no HTML and no HTTP anywhere in this app: the screens call Python
 * in this same process through OmertaClient, which goes to core/dispatch, the
 * same router every other front-end uses.
 *
 * The Compose tree lives in OmertaRoot.kt. This class exists to start the
 * backend and hand off.
 */
public class MainActivity extends ComponentActivity {

    /** Where a crash is written, so it survives the process that caused it. */
    static final String CRASH_FILE = "last_crash.txt";

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        installCrashHandler();
        maybeAskNotifications();
        // The backend is extracted and started on a background thread; the UI
        // shows what it is doing rather than a blank screen.
        BackendLauncher.start(this);
        OmertaRoot.install(this);
        take(getIntent());
    }

    /** singleTask: a second share arrives here, not through onCreate. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        take(intent);
    }

    /**
     * Whatever another app sent us.
     *
     * The manifest accepts every MIME type on purpose -- the attachment store
     * has no type rule -- so this reads the extras rather than trusting the
     * type: a "text/plain" share can still carry a STREAM, and a file share
     * can carry a title in EXTRA_TEXT.
     */
    private void take(Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }
        // The widget's SPEAK button. The microphone is opened HERE, in the
        // foreground, with the person looking at the app -- never from the
        // home screen.
        if (intent.getBooleanExtra(AskWidget.EXTRA_DICTATE, false)) {
            Intake.INSTANCE.requestDictation();
        }
        String action = intent.getAction();
        if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
            CharSequence sel = intent.getCharSequenceExtra(
                    Intent.EXTRA_PROCESS_TEXT);
            if (sel != null) {
                Intake.INSTANCE.offerText(sel.toString());
            }
            return;
        }
        if (!Intent.ACTION_SEND.equals(action)
                && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }
        Intake.INSTANCE.offerText(intent.getStringExtra(Intent.EXTRA_TEXT));

        List<String> uris = new ArrayList<>();
        Uri one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (one != null) {
            uris.add(one.toString());
        }
        ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (many != null) {
            for (Uri u : many) {
                if (u != null) {
                    uris.add(u.toString());
                }
            }
        }
        Intake.INSTANCE.offerFiles(uris);
    }

    /**
     * Keep the stack trace of a crash, on the device, for the owner to read.
     *
     * A crash that only exists in logcat is a crash nobody can send me: it
     * needs a cable, a laptop and adb, which is the whole reason the original
     * failure screen collects diagnostics instead. This writes the trace to a
     * file the Settings screen can show and share, and then hands the crash
     * back to the default handler so Android still does whatever it would
     * have done -- swallowing it would turn a crash into a freeze.
     */
    private void installCrashHandler() {
        final Thread.UncaughtExceptionHandler prior =
                Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                java.io.StringWriter sw = new java.io.StringWriter();
                java.io.PrintWriter pw = new java.io.PrintWriter(sw);
                pw.println("OMERTA crash");
                pw.println("when:    " + new java.util.Date());
                // Read from the installed package rather than BuildConfig:
                // BuildConfig is not generated unless the build feature is
                // on, and a crash handler that will not compile is worth
                // nothing at all.
                String build = "unknown";
                try {
                    android.content.pm.PackageInfo pi = getPackageManager()
                            .getPackageInfo(getPackageName(), 0);
                    build = pi.versionName + " (" + pi.versionCode + ")";
                } catch (Throwable ignored) {
                    // leave it unknown
                }
                pw.println("build:   " + build);
                pw.println("device:  " + Build.MANUFACTURER + " " + Build.MODEL);
                pw.println("android: " + Build.VERSION.RELEASE
                        + " (sdk " + Build.VERSION.SDK_INT + ")");
                pw.println("abis:    "
                        + java.util.Arrays.toString(Build.SUPPORTED_ABIS));
                pw.println("thread:  " + thread.getName());
                pw.println();
                error.printStackTrace(pw);
                pw.flush();
                java.io.File f = new java.io.File(getFilesDir(), CRASH_FILE);
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(f)) {
                    out.write(sw.toString().getBytes("UTF-8"));
                }
            } catch (Throwable ignored) {
                // A crash handler that crashes is worse than no crash handler.
            }
            if (prior != null) {
                prior.uncaughtException(thread, error);
            }
        });
    }

    private void maybeAskNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }
}
