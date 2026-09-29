package com.omerta.agent;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

/**
 * One tap from the home screen into a question.
 *
 * Deliberately dumb: it holds no state, polls nothing and starts no service.
 * A widget that woke the backend on a timer to show a live status would keep
 * a Python interpreter resident for a line of text nobody is reading, which
 * on a phone is a battery cost paid all day for a second saved once.
 *
 * SPEAK does not open the microphone here. It opens the app and asks it to
 * start dictation, so the recording is something the app does in the
 * foreground with the person looking at it -- a widget that could record from
 * the home screen is exactly the thing this project should not ship.
 */
public class AskWidget extends AppWidgetProvider {

    /** Read by MainActivity to decide whether to open dictation on launch. */
    public static final String EXTRA_DICTATE = "com.omerta.agent.DICTATE";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews views = new RemoteViews(ctx.getPackageName(),
                    R.layout.widget_ask);
            views.setOnClickPendingIntent(R.id.widget_ask, open(ctx, false));
            views.setOnClickPendingIntent(R.id.widget_speak, open(ctx, true));
            views.setOnClickPendingIntent(R.id.widget_title, open(ctx, false));
            manager.updateAppWidget(id, views);
        }
    }

    private PendingIntent open(Context ctx, boolean dictate) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra(EXTRA_DICTATE, dictate);
        // A distinct action per button: PendingIntents that differ only in
        // their extras are treated as the same intent and the second one
        // silently reuses the first one's extras.
        i.setAction(dictate ? "com.omerta.agent.WIDGET_SPEAK"
                            : "com.omerta.agent.WIDGET_ASK");
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(ctx, dictate ? 2 : 1, i, flags);
    }
}
