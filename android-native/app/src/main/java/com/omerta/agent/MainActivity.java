package com.omerta.agent;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
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
import android.os.Handler;
import android.os.Looper;

/**
 * OMERTA AGENT — thin shell around the agent's web UI.
 *
 * The agent itself runs as a Python backend (Termux on this phone, or a
 * machine on the LAN). An APK sandbox can't spawn git/adb/fastboot or a
 * build toolchain, so the brain deliberately stays where it has a shell —
 * this is the interface, not the agent.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "omerta";
    private static final String K_HOST = "host";
    private static final String K_TOKEN = "token";

    private static final int AMBER = Color.parseColor("#ffb020");
    private static final int BG = Color.parseColor("#0b0a08");
    private static final int PANEL = Color.parseColor("#141210");
    private static final int BORDER = Color.parseColor("#2a2620");
    private static final int TEXT = Color.parseColor("#e8ddc8");
    private static final int MUTED = Color.parseColor("#8a8272");

    private WebView web;
    private View connectScreen;
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

        connectScreen = buildConnectScreen();
        holder.addView(connectScreen, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        String host = prefs.getString(K_HOST, "127.0.0.1:8787");
        autoStart(host, prefs.getString(K_TOKEN, ""));
    }

    /**
     * Tap-the-icon flow: if the backend isn't up, ask Termux to start it,
     * poll until it answers, then load the UI. No terminal, no typing.
     */
    private void autoStart(final String host, final String token) {
        final boolean local = host.startsWith("127.0.0.1") || host.startsWith("localhost");
        status.setText("checking backend…");
        new Thread(() -> {
            if (BackendLauncher.isUp(host, 1500)) {
                ui(() -> connect(host, token));
                return;
            }
            if (!local) {                       // remote box: nothing we can start
                ui(() -> { showConnect(); status.setText(""); });
                return;
            }
            if (!BackendLauncher.termuxInstalled(MainActivity.this)) {
                ui(() -> { showConnect();
                    status.setText("Termux not installed — it runs the agent backend."); });
                return;
            }
            ui(() -> status.setText("starting backend via Termux…"));
            final boolean sent = BackendLauncher.start(MainActivity.this, 8787);
            // give it time to boot python + import the agent
            for (int i = 0; i < 40; i++) {
                try { Thread.sleep(750); } catch (InterruptedException ignored) {}
                if (BackendLauncher.isUp(host, 1200)) {
                    ui(() -> connect(host, token));
                    return;
                }
                final int sec = (i * 750) / 1000;
                ui(() -> status.setText("starting backend… " + sec + "s"));
            }
            ui(() -> {
                showConnect();
                status.setText(sent
                        ? "Backend didn't come up. In Termux run:  omerta serve\n"
                          + "If nothing happens, set allow-external-apps=true in\n"
                          + "~/.termux/termux.properties and restart Termux."
                        : "Termux refused the start request. Set\n"
                          + "allow-external-apps=true in ~/.termux/termux.properties.");
            });
        }).start();
    }

    private void ui(Runnable r) { new Handler(Looper.getMainLooper()).post(r); }

    /** Simple FrameLayout substitute so we avoid any support-library dependency. */
    private static class FrameHolder extends android.widget.FrameLayout {
        FrameHolder(android.content.Context c) { super(c); setBackgroundColor(BG); }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // the UI keeps state in localStorage
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
                    showConnect();
                    Toast.makeText(MainActivity.this,
                            "Can't reach the backend — is `omerta serve` running?",
                            Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    private View buildConnectScreen() {
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

        TextView sub = new TextView(this);
        sub.setText("\nConnect to your agent backend.\nTermux on this phone, or any machine on your network.\n");
        sub.setTextColor(MUTED);
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        sub.setGravity(Gravity.CENTER);
        root.addView(sub);

        final EditText host = field("127.0.0.1:8787", prefs.getString(K_HOST, "127.0.0.1:8787"));
        root.addView(label("BACKEND ADDRESS"));
        root.addView(host);

        final EditText token = field("token (blank for localhost)", prefs.getString(K_TOKEN, ""));
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
            connect(h, t);
        });
        root.addView(go);

        status = new TextView(this);
        status.setTextColor(AMBER);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(12), 0, 0);
        root.addView(status);

        Button retry = new Button(this);
        retry.setText("START BACKEND IN TERMUX");
        retry.setTextColor(AMBER);
        retry.setBackgroundColor(PANEL);
        retry.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rp.topMargin = dp(8);
        retry.setLayoutParams(rp);
        retry.setOnClickListener(v -> {
            if (!BackendLauncher.termuxInstalled(this)) {
                BackendLauncher.openTermux(this);
                return;
            }
            autoStart(prefs.getString(K_HOST, "127.0.0.1:8787"),
                      prefs.getString(K_TOKEN, ""));
        });
        root.addView(retry);

        TextView hint = new TextView(this);
        hint.setText("\nOn this phone: run  omerta serve  in Termux and keep "
                + "127.0.0.1:8787 — localhost needs no token.\n\n"
                + "Remote machine: use its LAN IP and the token the server printed.");
        hint.setTextColor(MUTED);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        root.addView(hint);

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

    private void connect(String hostPort, String token) {
        String url = "http://" + hostPort + "/";
        if (token != null && !token.isEmpty()) url += "?token=" + android.net.Uri.encode(token);
        connectScreen.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(url);
    }

    private void showConnect() {
        web.setVisibility(View.GONE);
        connectScreen.setVisibility(View.VISIBLE);
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getResources().getDisplayMetrics());
    }

    @Override
    public void onBackPressed() {
        if (web.getVisibility() == View.VISIBLE && web.canGoBack()) {
            web.goBack();
        } else if (web.getVisibility() == View.VISIBLE) {
            showConnect();                      // back out to the connect screen
        } else {
            super.onBackPressed();
        }
    }
}
