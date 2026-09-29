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

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
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

    private void maybeAskNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }
}
