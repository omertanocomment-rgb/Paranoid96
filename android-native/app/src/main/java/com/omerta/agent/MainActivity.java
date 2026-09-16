package com.omerta.agent;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * OMERTA AGENT — self-contained app.
 *
 * The agent backend runs INSIDE this app (Chaquopy + BackendService). On
 * launch we start it, wait for it to answer on loopback, then load its web UI
 * in the WebView. No Termux, no terminal, nothing to install. Power users can
 * still point the app at a backend on another machine over the LAN.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "omerta";
    private static final String K_HOST = "host";
    private static final String K_TOKEN = "token";
    private static final String LOCAL = "127.0.0.1:" + OmertaPython.PORT;

    private static final int AMBER = Color.parseColor("#ffb020");
    private static final int BG = Color.parseColor("#0b0a08");
    private static final int PANEL = Color.parseColor("#141210");
    private static final int TEXT = Color.parseColor("#e8ddc8");
    private static final int MUTED = Color.parseColor("#8a8272");

    private WebView web;
    private View statusScreen;
    private View remoteScreen;
    private TextView status;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        FrameHolder holder = new FrameHolder(this);
        setContentView(holder);

        web = new WebView(this);
        web.setBackgroundColor(BG);
        configureWebView();
        holder.addView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setVisibility(View.GONE);

        statusScreen = buildStatusScreen();
        holder.addView(statusScreen, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        remoteScreen = buildRemoteScreen();
        remoteScreen.setVisibility(View.GONE);
        holder.addView(remoteScreen, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        maybeAskNotifications();

        // If the user previously pinned a remote backend, honour it; otherwise
        // run the embedded one.
        String host = prefs.getString(K_HOST, LOCAL);
        if (host.equals(LOCAL)) {
            startEmbedded();
        } else {
            connectRemote(host, prefs.getString(K_TOKEN, ""));
        }
    }

    private void maybeAskNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    /** Start the in-app backend and wait for it to come up. */
    private void startEmbedded() {
        showStatus();
        status.setText("starting agent…");
        BackendLauncher.start(this);
        new Thread(() -> {
            // first launch extracts Python + payload and compiles bytecode,
            // so give it a generous window.
            for (int i = 0; i < 120; i++) {
                if (BackendLauncher.isUp(LOCAL, 1200)) {
                    ui(() -> connect(OmertaPython.baseUrl()));
                    return;
                }
                final int sec = i;
                ui(() -> status.setText("starting agent… " + sec + "s\n"
                        + "(first launch unpacks Python — this is a one-time step)"));
                try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
            }
            ui(() -> status.setText("Backend didn't come up.\n"
                    + "Reopen the app, or use Advanced to connect to a LAN backend."));
        }, "omerta-wait").start();
    }

    private void connectRemote(final String host, final String token) {
        showStatus();
        status.setText("connecting to " + host + "…");
        new Thread(() -> {
            if (BackendLauncher.isUp(host, 2500)) {
                ui(() -> {
                    String url = "http://" + host + "/";
                    if (token != null && !token.isEmpty())
                        url += "?token=" + android.net.Uri.encode(token);
                    connect(url);
                });
            } else {
                ui(() -> { showRemote();
                    status.setText("Couldn't reach " + host); });
            }
        }, "omerta-remote").start();
    }

    private void ui(Runnable r) { new Handler(Looper.getMainLooper()).post(r); }

    private static class FrameHolder extends android.widget.FrameLayout {
        FrameHolder(android.content.Context c) { super(c); setBackgroundColor(BG); }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req != null && req.isForMainFrame()) {
                    showStatus();
                    status.setText("Lost the backend — retrying…");
                    Toast.makeText(MainActivity.this,
                            "Reconnecting to the agent backend…", Toast.LENGTH_SHORT).show();
                    ui(() -> new Handler(Looper.getMainLooper()).postDelayed(
                            () -> startEmbedded(), 1500));
                }
            }
        });
    }

    // ── status / splash screen ───────────────────────────────────────────
    private View buildStatusScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(BG);
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("OMERTA AGENT");
        title.setTextColor(AMBER);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setGravity(Gravity.CENTER);
        title.setLetterSpacing(0.18f);
        root.addView(title);

        status = new TextView(this);
        status.setTextColor(MUTED);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(18), 0, 0);
        root.addView(status);

        Button advanced = new Button(this);
        advanced.setText("ADVANCED — CONNECT TO A LAN BACKEND");
        advanced.setAllCaps(true);
        advanced.setTextColor(MUTED);
        advanced.setBackgroundColor(PANEL);
        advanced.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(28);
        advanced.setLayoutParams(lp);
        advanced.setOnClickListener(v -> showRemote());
        root.addView(advanced);

        return root;
    }

    // ── remote (LAN) connect screen ──────────────────────────────────────
    private View buildRemoteScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(BG);
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("CONNECT TO A BACKEND");
        title.setTextColor(AMBER);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        title.setGravity(Gravity.CENTER);
        title.setLetterSpacing(0.14f);
        root.addView(title);

        TextView sub = new TextView(this);
        sub.setText("\nRun `omerta serve` on another machine and enter its LAN "
                + "address and token. Or go back to use the built-in agent.\n");
        sub.setTextColor(MUTED);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        sub.setGravity(Gravity.CENTER);
        root.addView(sub);

        final EditText host = field("192.168.1.42:8787", prefs.getString(K_HOST, ""));
        root.addView(label("BACKEND ADDRESS"));
        root.addView(host);

        final EditText token = field("token from the server console",
                prefs.getString(K_TOKEN, ""));
        token.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        root.addView(label("ACCESS TOKEN"));
        root.addView(token);

        Button go = new Button(this);
        go.setText("CONNECT");
        go.setAllCaps(true);
        go.setTextColor(Color.BLACK);
        go.setBackgroundColor(AMBER);
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = dp(18);
        go.setLayoutParams(bp);
        go.setOnClickListener(v -> {
            String h = host.getText().toString().trim().replaceAll("^https?://", "");
            if (h.isEmpty()) return;
            String t = token.getText().toString().trim();
            prefs.edit().putString(K_HOST, h).putString(K_TOKEN, t).apply();
            connectRemote(h, t);
        });
        root.addView(go);

        Button back = new Button(this);
        back.setText("USE BUILT-IN AGENT");
        back.setTextColor(AMBER);
        back.setBackgroundColor(PANEL);
        back.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.topMargin = dp(10);
        back.setLayoutParams(rp);
        back.setOnClickListener(v -> {
            prefs.edit().putString(K_HOST, LOCAL).putString(K_TOKEN, "").apply();
            startEmbedded();
        });
        root.addView(back);

        return root;
    }

    private TextView label(String s) {
        TextView t = new TextView(this);
        t.setText("\n" + s);
        t.setTextColor(MUTED);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        t.setLetterSpacing(0.12f);
        return t;
    }

    private EditText field(String hint, String value) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setText(value);
        e.setSingleLine(true);
        e.setTextColor(TEXT);
        e.setHintTextColor(MUTED);
        e.setBackgroundColor(PANEL);
        e.setPadding(dp(14), dp(14), dp(14), dp(14));
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        return e;
    }

    private void connect(String url) {
        statusScreen.setVisibility(View.GONE);
        remoteScreen.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(url);
    }

    private void showStatus() {
        web.setVisibility(View.GONE);
        remoteScreen.setVisibility(View.GONE);
        statusScreen.setVisibility(View.VISIBLE);
    }

    private void showRemote() {
        web.setVisibility(View.GONE);
        statusScreen.setVisibility(View.GONE);
        remoteScreen.setVisibility(View.VISIBLE);
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getResources().getDisplayMetrics());
    }

    @Override
    public void onBackPressed() {
        if (web.getVisibility() == View.VISIBLE && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
