package com.enevolex.enex;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.enevolex.enex.net.Unblocker;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Tema Stüdyosu: alttan açılan panel (assets/studio.html). Değişiklikler arkadaki Discord'a
 * anında yansır. Panel sadece uygulamanın kendi dosyasını açar; JS köprüsü dışarıya açık değildir.
 */
public final class StudioSheet {
    public interface Callback { void done(JSONObject result); }

    private final MainActivity act;
    private final Settings settings;
    private final Unblocker unblocker;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final FrameLayout root;
    private final View scrim;
    private final FrameLayout sheet;
    private final WebView web;
    private boolean open;
    private boolean ready;
    private int insetTop, insetBottom;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    StudioSheet(MainActivity act, Settings settings, Unblocker unblocker) {
        this.act = act;
        this.settings = settings;
        this.unblocker = unblocker;
        root = new FrameLayout(act);
        root.setVisibility(View.GONE);
        scrim = new View(act);
        scrim.setBackgroundColor(0x99000000);
        scrim.setOnClickListener(v -> close());
        root.addView(scrim, new FrameLayout.LayoutParams(-1, -1));

        sheet = new FrameLayout(act);
        GradientDrawable bg = new GradientDrawable();
        float r = act.getResources().getDisplayMetrics().density * 22;
        bg.setCornerRadii(new float[]{r, r, r, r, 0, 0, 0, 0});
        bg.setColor(0xFF0B0A12);
        sheet.setBackground(bg);
        sheet.setClipToOutline(true);
        sheet.setElevation(r);
        root.addView(sheet, new FrameLayout.LayoutParams(-1, -1, Gravity.BOTTOM));

        web = new WebView(act);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, android.webkit.WebResourceRequest req) { return true; }
            @Override public void onPageFinished(WebView v, String url) { ready = true; }
        });
        web.addJavascriptInterface(new Bridge(), "EnexStudio");
        sheet.addView(web, new FrameLayout.LayoutParams(-1, -1));
        web.loadUrl("file:///android_asset/studio.html");
    }

    View view() { return root; }
    boolean isOpen() { return open; }

    void setInsets(int top, int bottom) {
        insetTop = top;
        insetBottom = bottom;
        layoutSheet();
    }

    private void layoutSheet() {
        int h = root.getHeight();
        if (h == 0) { root.post(this::layoutSheet); return; }
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) sheet.getLayoutParams();
        lp.height = Math.round((h - insetTop) * 0.86f);
        sheet.setLayoutParams(lp);
        sheet.setPadding(0, 0, 0, insetBottom);
    }

    void open() {
        open = true;
        root.setVisibility(View.VISIBLE);
        layoutSheet();
        pushState();
        root.post(() -> {
            sheet.setTranslationY(sheet.getHeight() > 0 ? sheet.getHeight() : root.getHeight());
            scrim.setAlpha(0f);
            scrim.animate().alpha(1f).setDuration(220).start();
            sheet.animate().translationY(0).setDuration(320).setInterpolator(new DecelerateInterpolator(2f)).start();
        });
    }

    void close() {
        open = false;
        scrim.animate().alpha(0f).setDuration(200).start();
        sheet.animate().translationY(sheet.getHeight()).setDuration(240).setInterpolator(new DecelerateInterpolator())
                .withEndAction(() -> { if (!open) root.setVisibility(View.GONE); }).start();
    }

    /* ---------------- Durum ---------------- */

    JSONObject state() {
        JSONObject o = new JSONObject();
        try {
            o.put("settings", settings.json());
            o.put("lang", I18n.lang());
            o.put("strings", I18n.dict());
            JSONArray themes = new JSONArray();
            for (String id : Settings.THEMES) {
                JSONObject t = new JSONObject();
                t.put("id", id);
                t.put("colors", new JSONArray(Settings.colors(id)));
                t.put("name", I18n.t("theme." + id + ".name"));
                t.put("desc", I18n.t("theme." + id + ".desc"));
                themes.put(t);
            }
            o.put("themes", themes);
            String wp = settings.wallpaper();
            o.put("wallpaperName", wp != null && new File(wp).exists() ? settings.str("wallpaperName") : JSONObject.NULL);
            o.put("bundledIsAnime", PageState.bundledWallpaper(act, true).contains("varsayilan"));
            o.put("dpi", unblocker.view());
            o.put("dpiSearching", unblocker.searching());
            o.put("activity", act.activityStatus());
            o.put("notifAllowed", Notifier.allowed(act));
            o.put("blurSupported", Build.VERSION.SDK_INT >= 31);
            o.put("version", BuildConfig.VERSION_NAME);
        } catch (Exception e) {
            EnexLog.d("studio", "durum: " + e);
        }
        return o;
    }

    private void js(String code) {
        main.post(() -> { if (ready) web.evaluateJavascript(code, null); });
    }

    void pushState() { js("window.__studioPush && window.__studioPush('state'," + state() + ")"); }
    void pushDpi() { js("window.__studioPush && window.__studioPush('dpi'," + unblocker.view() + ")"); }
    void pushActivity() { js("window.__studioPush && window.__studioPush('activity'," + act.activityStatus() + ")"); }

    private void callback(String id, JSONObject result) {
        js("window.__studioCb && window.__studioCb(" + Util.jsString(id) + "," + (result == null ? "null" : result.toString()) + ")");
    }

    /* ---------------- JS köprüsü (sadece studio.html) ---------------- */
    private final class Bridge {
        @JavascriptInterface
        public String getState() { return state().toString(); }

        @JavascriptInterface
        public String set(String patchJson) {
            try {
                JSONObject patch = new JSONObject(patchJson);
                Set<String> changed = settings.update(patch);
                if (changed.contains("lang")) I18n.setPref(settings.str("lang"));
                main.post(() -> act.onSettingsChanged(changed));
            } catch (Exception e) {
                EnexLog.d("studio", "ayar: " + e);
            }
            return state().toString();
        }

        @JavascriptInterface
        public void testDpi(String cb) {
            io.execute(() -> callback(cb, unblocker.test()));
        }

        @JavascriptInterface
        public void researchDpi(String cb) {
            main.post(() -> {
                act.researchAndReload();
                // Durum, arama bitince pushState ile gelir
                callback(cb, state());
            });
        }

        @JavascriptInterface
        public void pickWallpaper(String cb) {
            main.post(() -> act.pickWallpaper(r -> callback(cb, state())));
        }

        @JavascriptInterface
        public void openNotifAccess() {
            main.post(() -> {
                try {
                    act.startActivity(new Intent(android.provider.Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface
        public void allowNotifications() { main.post(act::requestNotificationPermission); }

        @JavascriptInterface
        public void shareLog() {
            main.post(() -> {
                try {
                    File f = EnexLog.file();
                    Uri uri = LogProvider.uri(act, f);
                    Intent i = new Intent(Intent.ACTION_SEND)
                            .setType("text/plain")
                            .putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    act.startActivity(Intent.createChooser(i, "enex-debug.log"));
                } catch (Exception e) {
                    EnexLog.d("studio", "günlük paylaşılamadı: " + e);
                }
            });
        }

        @JavascriptInterface
        public void close() { main.post(StudioSheet.this::close); }
    }
}
