package com.omerta.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Foreground service that hosts the embedded Python backend for the app's
 * lifetime. Running it in the foreground (with an ongoing notification) keeps
 * Android from killing the process while the user is mid-task — the agent may
 * be running a long build or waiting on an approval.
 *
 * The Python HTTP server itself runs on a daemon thread started by
 * OmertaPython; this service just owns the process and reports readiness.
 */
public class BackendService extends Service {

    private static final String CHANNEL_ID = "omerta_backend";
    private static final int NOTIF_ID = 1;

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundCompat(buildNotification("starting…"));
    }

    private void startForegroundCompat(Notification n) {
        // From API 34 the type must be passed explicitly to startForeground.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        new Thread(() -> {
            OmertaPython.ensureStarted(getApplicationContext());
            updateNotification(OmertaPython.isReady()
                    ? "running on 127.0.0.1:" + OmertaPython.port()
                    : "backend failed to start");
        }, "omerta-backend-boot").start();
        // restart if the OS kills us; the extraction/boot is idempotent
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    static void startService(Context ctx) {
        Intent i = new Intent(ctx, BackendService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    private Notification buildNotification(String text) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "OMERTA backend", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Keeps the agent backend running");
            nm.createNotificationChannel(ch);
        }
        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return b.setContentTitle("OMERTA AGENT")
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(text));
    }
}
