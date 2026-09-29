package com.omerta.agent;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.activity.ComponentActivity;

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
    }

    private void maybeAskNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }
}
