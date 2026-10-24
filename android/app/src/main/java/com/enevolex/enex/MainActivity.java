package com.enevolex.enex;

import android.Manifest;
import android.animation.ValueAnimator;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.Menu;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.enevolex.enex.net.Unblocker;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Enex'in tek ekranı: Discord'un web uygulaması + tema + Enex düğmesi + Tema Stüdyosu paneli. */
public final class MainActivity extends Activity {
    static final String HOME_URL = "https://discord.com/app";
    static final Set<String> ORIGINS = new HashSet<>(Arrays.asList(
            "https://discord.com", "https://ptb.discord.com", "https://canary.discord.com"));
    private static final int RC_FILE = 11, RC_WALL = 12, RC_MEDIA = 21, RC_NOTIF = 22, RC_STORAGE = 23;
    private static final Set<String> VISUAL_KEYS = new HashSet<>(Arrays.asList(
            "theme", "fx", "cards", "clean", "accent", "glassMode", "glassAlpha", "animeAlpha", "wallDim",
            "wallpaper", "wallpaperName", "layout", "uiScale", "lang"));

    private final Handler main = new Handler(Looper.getMainLooper());
    private Settings settings;
    private Unblocker unblocker;
    private Interceptor interceptor;
    private Notifier notifier;
    private Downloader downloader;
    private MusicWatcher music;

    private FrameLayout root;
    private FrameLayout content;
    private WebView web;
    private View loading;
    private TextView loadingText;
    private Button retryBtn;
    private ImageView fab;
    private FrameLayout fullscreen;
    private StudioSheet studio;

    private String userAgent;
    private JavaScriptReplyProxy reply;
    private boolean docStartScript;
    private String injectJs;
    private boolean pageLoadedOnce;
    private boolean pageError;
    private boolean drawerOpen;
    private int lastWidthDp;
    private JSONObject lastMusic;
    private JSONObject bridgeDiag;
    private String lastDiag = "";

    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingPermission;
    private StudioSheet.Callback pendingWallCallback;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    /* ===================================================================== */

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (KeepAliveService.ACTION_QUIT.equals(getIntent().getAction())) { finishAndRemoveTask(); return; }
        settings = Settings.get(this);
        I18n.setPref(settings.str("lang"));
        unblocker = ((EnexApp) getApplication()).unblocker();
        interceptor = new Interceptor(this, settings, unblocker);
        notifier = new Notifier(this, unblocker);
        downloader = new Downloader(this, unblocker);
        music = new MusicWatcher(this, settings, this::sendToPage);

        buildUi();
        applyWindowLook();

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showLoading(I18n.t("webview.old"));
            return;
        }
        Unblocker.proxySupported = WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE);
        setupWebView();

        unblocker.setListener(new Unblocker.Listener() {
            @Override public void onProgress(String text) { if (loading.getVisibility() == View.VISIBLE) loadingText.setText(text); }
            @Override public void onStatus() { if (studio != null) studio.pushDpi(); }
        });
        showLoading(I18n.t("loading.connecting"));
        final String start = urlFromIntent(getIntent());
        unblocker.apply(false, () -> {
            loadingText.setText(I18n.t("loading.page"));
            web.loadUrl(start != null ? start : HOME_URL);
        });

        askNotificationPermissionOnce();
        if (settings.bool("keepAlive")) KeepAliveService.start(this);
        music.refresh();
    }

    /* ---------------- Arayüz ---------------- */

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void buildUi() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
        }
        root = new FrameLayout(this);
        content = new FrameLayout(this);
        root.addView(content, new FrameLayout.LayoutParams(-1, -1));

        web = new WebView(this);
        content.addView(web, new FrameLayout.LayoutParams(-1, -1));

        loading = buildLoading();
        content.addView(loading, new FrameLayout.LayoutParams(-1, -1));

        fab = buildFab();
        int size = dp(46);
        content.addView(fab, new FrameLayout.LayoutParams(size, size));

        fullscreen = new FrameLayout(this);
        fullscreen.setBackgroundColor(Color.BLACK);
        fullscreen.setVisibility(View.GONE);
        root.addView(fullscreen, new FrameLayout.LayoutParams(-1, -1));

        // Sistem çubukları ve klavye kadar iç boşluk (Android 15'te kenardan kenara zorunlu)
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            content.setPadding(l, t, r, b);
            if (studio != null) studio.setInsets(t, b);
            return insets;
        });
        setContentView(root);
        content.addOnLayoutChangeListener((v, a, b, c, d, e, f, g, h) -> {
            int wdp = Math.round(web.getWidth() / getResources().getDisplayMetrics().density);
            if (wdp > 0 && wdp != lastWidthDp) {
                lastWidthDp = wdp;
                pushState();
            }
            placeFab(false);
        });
    }

    private View buildLoading() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{0xFF1A1236, 0xFF07060F, 0xFF07060F, 0xFF0C1C26});
        box.setBackground(bg);
        box.setClickable(true);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.enex_logo);
        box.addView(logo, new LinearLayout.LayoutParams(dp(96), dp(96)));
        ValueAnimator pulse = ValueAnimator.ofFloat(1f, 1.06f);
        pulse.setDuration(1200);
        pulse.setRepeatMode(ValueAnimator.REVERSE);
        pulse.setRepeatCount(ValueAnimator.INFINITE);
        pulse.addUpdateListener(a -> { float s = (float) a.getAnimatedValue(); logo.setScaleX(s); logo.setScaleY(s); });
        pulse.start();

        TextView word = new TextView(this) {
            @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
                super.onSizeChanged(w, h, ow, oh);
                getPaint().setShader(new LinearGradient(0, 0, w, 0, new int[]{0xFFB39DFF, 0xFFF472B6, 0xFF38D9F5}, null, Shader.TileMode.CLAMP));
            }
        };
        word.setText("ENEX");
        word.setTextColor(Color.WHITE);
        word.setTextSize(22);
        word.setLetterSpacing(0.32f);
        word.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams wl = new LinearLayout.LayoutParams(-2, -2);
        wl.topMargin = dp(20);
        box.addView(word, wl);

        View bar = new View(this) {
            final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
            final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
            float t;
            {
                track.setColor(0x14FFFFFF);
                ValueAnimator a = ValueAnimator.ofFloat(0f, 1f);
                a.setDuration(1300);
                a.setRepeatCount(ValueAnimator.INFINITE);
                a.addUpdateListener(x -> { t = (float) x.getAnimatedValue(); invalidate(); });
                a.start();
            }
            @Override protected void onDraw(Canvas c) {
                float w = getWidth(), h = getHeight(), r = h / 2;
                c.drawRoundRect(0, 0, w, h, r, r, track);
                float seg = w * 0.4f;
                float x = -seg + t * (w + seg);
                fill.setShader(new LinearGradient(x, 0, x + seg, 0, new int[]{0xFF8B5CF6, 0xFFEC4899, 0xFF22D3EE}, null, Shader.TileMode.CLAMP));
                c.save();
                c.clipRect(0, 0, w, h);
                c.drawRoundRect(x, 0, x + seg, h, r, r, fill);
                c.restore();
            }
        };
        LinearLayout.LayoutParams bl = new LinearLayout.LayoutParams(dp(200), dp(3));
        bl.topMargin = dp(22);
        box.addView(bar, bl);

        loadingText = new TextView(this);
        loadingText.setTextColor(0xFF9A97B0);
        loadingText.setTextSize(13);
        loadingText.setGravity(Gravity.CENTER);
        loadingText.setPadding(dp(24), 0, dp(24), 0);
        LinearLayout.LayoutParams tl = new LinearLayout.LayoutParams(-1, -2);
        tl.topMargin = dp(20);
        box.addView(loadingText, tl);

        retryBtn = new Button(this);
        retryBtn.setText(I18n.t("studio.dpi.research"));
        retryBtn.setAllCaps(false);
        retryBtn.setVisibility(View.GONE);
        retryBtn.setOnClickListener(v -> researchAndReload());
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(-2, -2);
        rl.topMargin = dp(16);
        box.addView(retryBtn, rl);
        return box;
    }

    private void showLoading(String text) {
        loading.animate().cancel();
        loading.setAlpha(1f);
        loading.setVisibility(View.VISIBLE);
        loadingText.setText(text);
        retryBtn.setVisibility(View.GONE);
        if (fab != null) fab.setVisibility(View.GONE);
    }

    private void hideLoading() {
        if (loading.getVisibility() != View.VISIBLE) return;
        loading.animate().alpha(0f).setDuration(350).withEndAction(() -> {
            loading.setVisibility(View.GONE);
            fab.setVisibility(View.VISIBLE);
        }).start();
    }

    /* ---------- Enex düğmesi: sürüklenir, kenara yapışır; dokununca menü ---------- */
    @SuppressLint("ClickableViewAccessibility")
    private ImageView buildFab() {
        ImageView b = new ImageView(this);
        b.setImageResource(R.drawable.enex_logo);
        b.setAlpha(0.85f);
        b.setElevation(dp(6));
        b.setVisibility(View.GONE);
        b.setContentDescription("Enex");
        final int slop = ViewConfiguration.get(this).getScaledTouchSlop();
        final float[] down = new float[4];
        final boolean[] dragging = {false};
        b.setOnTouchListener((v, e) -> {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    down[0] = e.getRawX(); down[1] = e.getRawY(); down[2] = v.getX(); down[3] = v.getY();
                    dragging[0] = false;
                    v.setAlpha(1f);
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float dx = e.getRawX() - down[0], dy = e.getRawY() - down[1];
                    if (!dragging[0] && Math.hypot(dx, dy) > slop) dragging[0] = true;
                    if (dragging[0]) { v.setX(down[2] + dx); v.setY(down[3] + dy); }
                    return true;
                }
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    v.setAlpha(0.85f);
                    if (dragging[0]) {
                        int W = content.getWidth() - content.getPaddingLeft() - content.getPaddingRight();
                        int H = content.getHeight() - content.getPaddingTop() - content.getPaddingBottom();
                        float cx = v.getX() + v.getWidth() / 2f - content.getPaddingLeft();
                        settings.putQuiet("fabX", cx < W / 2f ? 0 : 1);
                        settings.putQuiet("fabY", Util.clamp((v.getY() - content.getPaddingTop()) / Math.max(1, H - v.getHeight()), 0, 1));
                        placeFab(true);
                    } else if (e.getActionMasked() == MotionEvent.ACTION_UP) {
                        showMenu();
                    }
                    return true;
            }
            return false;
        });
        return b;
    }

    private void placeFab(boolean animate) {
        if (fab == null || content.getWidth() == 0) return;
        int W = content.getWidth() - content.getPaddingLeft() - content.getPaddingRight();
        int H = content.getHeight() - content.getPaddingTop() - content.getPaddingBottom();
        int side = (int) settings.num("fabX");
        double fy = settings.num("fabY");
        if (side < 0) side = 1;
        if (fy < 0) fy = 0.62;
        float x = content.getPaddingLeft() + (side == 0 ? dp(6) : W - fab.getWidth() - dp(6));
        float y = content.getPaddingTop() + (float) (fy * Math.max(1, H - fab.getHeight()));
        if (animate) fab.animate().x(x).y(y).setDuration(220).setInterpolator(new DecelerateInterpolator()).start();
        else { fab.setX(x); fab.setY(y); }
    }

    private void showMenu() {
        PopupMenu pm = new PopupMenu(this, fab);
        Menu m = pm.getMenu();
        boolean mobile = "mobile".equals(settings.str("layout"));
        if (mobile) m.add(0, 1, 0, drawerOpen ? I18n.t("menu.chat") : I18n.t("menu.drawer"));
        m.add(0, 2, 1, I18n.t("menu.studio"));
        m.add(0, 3, 2, I18n.t("menu.reload"));
        pm.setOnMenuItemClickListener(it -> {
            switch (it.getItemId()) {
                case 1: web.evaluateJavascript("window.__enexDrawer && window.__enexDrawer('toggle')", null); return true;
                case 2: openStudio(); return true;
                case 3: web.reload(); return true;
            }
            return false;
        });
        pm.show();
    }

    /* ---------- Pencere görünümü: Cam teması telefonun duvar kağıdını gösterir ---------- */
    private void applyWindowLook() {
        String theme = settings.theme();
        boolean glass = "glass".equals(theme);
        Window w = getWindow();
        if (glass) {
            w.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER);
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            root.setBackgroundColor(Color.TRANSPARENT);
            web.setBackgroundColor(Color.TRANSPARENT);
            boolean blur = "acrylic".equals(settings.str("glassMode")) && Build.VERSION.SDK_INT >= 31;
            if (blur) {
                w.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND);
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.setBlurBehindRadius(dp(28));
                w.setAttributes(lp);
            } else {
                w.clearFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND);
            }
        } else {
            w.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER | WindowManager.LayoutParams.FLAG_BLUR_BEHIND);
            int bg = Color.parseColor(Settings.colors(theme)[0]);
            if ("anime".equals(theme)) bg = 0xFF0B0B2B;
            w.setBackgroundDrawable(new ColorDrawable(bg));
            root.setBackgroundColor(bg);
            web.setBackgroundColor(bg);
            if (Build.VERSION.SDK_INT < 30) w.setStatusBarColor(bg);
        }
    }

    /* ---------------- WebView ---------------- */

    @SuppressLint({"SetJavaScriptEnabled", "RequiresFeature"})
    private void setupWebView() {
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setSupportZoom(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setTextZoom(100);
        ws.setSupportMultipleWindows(true);
        ws.setJavaScriptCanOpenWindowsAutomatically(true);
        userAgent = desktopUserAgent(WebSettings.getDefaultUserAgent(this));
        ws.setUserAgentString(userAgent);
        interceptor.setUserAgent(userAgent);
        if (Build.VERSION.SDK_INT >= 26) web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        injectJs = PageState.asset(this, "page/inject.js");
        WebViewCompat.addWebMessageListener(web, "EnexNative", ORIGINS, this::onPageMessage);
        docStartScript = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (docStartScript) WebViewCompat.addDocumentStartJavaScript(web, injectJs, ORIGINS);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, ua, cd, mime, len) -> onDownload(url, cd, mime));

        if (Build.VERSION.SDK_INT >= 24) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return interceptor.intercept(request);
                }
            });
        }
    }

    /** Masaüstü tarayıcı kimliği: Discord'un tam web uygulamasını (ve sesli sohbeti) açar. */
    static String desktopUserAgent(String def) {
        String ver = "130.0.0.0";
        Matcher m = Pattern.compile("Chrome/([\\d.]+)").matcher(def == null ? "" : def);
        if (m.find()) {
            String major = m.group(1).split("\\.")[0];
            ver = major + ".0.0.0";
        }
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + ver + " Safari/537.36";
    }

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return interceptor.intercept(request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if ("https".equals(u.getScheme()) && Interceptor.isDiscordHost(u.getHost())) return false;
            // hCaptcha ve Discord'un kendi iframe'leri sayfanın içinde kalır
            if (!request.isForMainFrame()) return false;
            openExternal(u);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            reply = null;
            pageError = false;
            if (!docStartScript && url != null && url.startsWith("https://")) view.evaluateJavascript(injectJs, null);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url == null || !url.startsWith("https://")) return;
            if (!docStartScript) view.evaluateJavascript(injectJs, null);
            pushState();
            pageLoadedOnce = true;
            if (!pageError) main.postDelayed(() -> { if (!pageError) hideLoading(); }, 500);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            pageError = true;
            EnexLog.d("main", "sayfa yüklenemedi: " + error.getErrorCode() + " " + error.getDescription());
            showLoading(I18n.t("dpi.unreachable", Util.vars("err", String.valueOf(error.getDescription()))));
            retryBtn.setVisibility(View.VISIBLE);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            EnexLog.d("main", "Discord sayfası çöktü (crash=" + detail.didCrash() + ")");
            // WebView'ı yeniden kurmanın en güvenli yolu ekranı yeniden oluşturmak
            recreate();
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            main.post(() -> handlePermission(request));
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent i = params.createIntent();
                i.addCategory(Intent.CATEGORY_OPENABLE);
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                if (i.getType() == null || i.getType().isEmpty()) i.setType("*/*");
                startActivityForResult(Intent.createChooser(i, null), RC_FILE);
                return true;
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // Discord dış bağlantıları window.open ile açar: adresi yakalayıp tarayıcıya ver
            WebView temp = new WebView(MainActivity.this);
            temp.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                    handleOpened(r.getUrl());
                    v.destroy();
                    return true;
                }
                @Override public void onPageStarted(WebView v, String url, Bitmap f) {
                    if (url != null && !url.equals("about:blank")) {
                        handleOpened(Uri.parse(url));
                        v.stopLoading();
                        v.destroy();
                    }
                }
            });
            WebView.WebViewTransport t = (WebView.WebViewTransport) resultMsg.obj;
            t.setWebView(temp);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) { callback.onCustomViewHidden(); return; }
            customView = view;
            customViewCallback = callback;
            fullscreen.addView(view, new FrameLayout.LayoutParams(-1, -1));
            fullscreen.setVisibility(View.VISIBLE);
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            String s = m.message();
            if (s != null && s.startsWith("[Enex]")) EnexLog.d("page", s.substring(6).trim());
            return true;
        }
    }

    private void hideCustomView() {
        if (customView == null) return;
        fullscreen.removeView(customView);
        fullscreen.setVisibility(View.GONE);
        customView = null;
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    private void handleOpened(Uri u) {
        if (u == null) return;
        if ("https".equals(u.getScheme()) && Interceptor.isDiscordHost(u.getHost())) {
            String p = u.getPath() == null ? "" : u.getPath();
            if (p.startsWith("/popout")) return; // ayrı pencere: telefonda desteklenmiyor
            web.loadUrl(u.toString());
            return;
        }
        openExternal(u);
    }

    private void openExternal(Uri u) {
        try {
            Intent i;
            if ("intent".equals(u.getScheme())) i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
            else i = new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            startActivity(i);
        } catch (Exception e) {
            EnexLog.d("main", "dış bağlantı açılamadı: " + u.getScheme());
        }
    }

    /* ---------------- Sayfa ile mesajlaşma ---------------- */

    private void onPageMessage(WebView view, WebMessageCompat message, Uri origin, boolean isMainFrame, JavaScriptReplyProxy proxy) {
        if (!isMainFrame || message.getData() == null) return;
        JSONObject m;
        try { m = new JSONObject(message.getData()); } catch (Exception e) { return; }
        String t = m.optString("t");
        switch (t) {
            case "hello":
                reply = proxy;
                pushState();
                if (lastMusic != null) sendToPage(lastMusic);
                break;
            case "notify":
                if (settings.bool("notify")) {
                    notifier.show(m.optInt("id"), m.optString("title"), m.optString("body"), m.optString("icon"), m.optString("tag"));
                }
                break;
            case "save":
                downloader.saveBase64(m.optString("name"), m.optString("mime"), m.optString("data"));
                break;
            case "drawer":
                drawerOpen = m.optBoolean("open");
                break;
            case "diag": {
                bridgeDiag = m;
                String key = m.toString();
                if (!key.equals(lastDiag)) { lastDiag = key; EnexLog.d("bridge", key); }
                if (studio != null) studio.pushActivity();
                break;
            }
            case "bridge-ready":
                EnexLog.d("bridge", "etkinlik köprüsü hazır");
                if (lastMusic != null) sendToPage(lastMusic);
                if (studio != null) studio.pushActivity();
                break;
            case "act":
                if (studio != null) studio.pushActivity();
                break;
            case "log":
                EnexLog.d("page", m.optString("msg"));
                break;
            default:
                break;
        }
    }

    /** Uygulamadan sayfaya mesaj. */
    void sendToPage(JSONObject msg) {
        if ("activity".equals(msg.optString("t"))) lastMusic = msg;
        String json = msg.toString();
        main.post(() -> {
            if (web == null) return;
            if (reply != null) {
                try { reply.postMessage(json); return; } catch (Exception ignored) {}
            }
            web.evaluateJavascript("window.__enexRecv && window.__enexRecv(" + json + ")", null);
        });
    }

    void pushState() {
        if (web == null) return;
        int wdp = lastWidthDp > 0 ? lastWidthDp
                : Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
        sendToPage(PageState.build(this, settings, wdp));
    }

    /* ---------------- Ayar değişiklikleri (Stüdyodan) ---------------- */

    void onSettingsChanged(Set<String> changed) {
        if (changed.isEmpty()) return;
        if (changed.contains("lang")) {
            I18n.setPref(settings.str("lang"));
            Notifier.createChannels(this);
        }
        boolean visual = false;
        for (String k : changed) if (VISUAL_KEYS.contains(k)) { visual = true; break; }
        if (visual) {
            applyWindowLook();
            pushState();
        }
        if (changed.contains("dpiEnabled")) researchOrApply(false);
        if (changed.contains("keepAlive")) {
            if (settings.bool("keepAlive")) KeepAliveService.start(this);
            else KeepAliveService.stop(this);
        }
        if (changed.contains("activityMusic") || changed.contains("musicSources") || changed.contains("musicBlock")) {
            music.refresh();
        }
    }

    void researchAndReload() { researchOrApply(true); }

    private void researchOrApply(boolean force) {
        showLoading(I18n.t("loading.connecting"));
        unblocker.apply(force, () -> {
            loadingText.setText(I18n.t("loading.page"));
            if (pageLoadedOnce) web.reload(); else web.loadUrl(HOME_URL);
            if (studio != null) studio.pushState();
        });
    }

    /* ---------------- Stüdyo ---------------- */

    void openStudio() {
        if (studio == null) {
            studio = new StudioSheet(this, settings, unblocker);
            root.addView(studio.view(), new FrameLayout.LayoutParams(-1, -1));
            root.requestApplyInsets();
        }
        studio.open();
    }

    JSONObject activityStatus() {
        JSONObject a = new JSONObject();
        try {
            a.put("access", MediaListener.granted(this));
            a.put("music", music.sharedName() == null ? JSONObject.NULL : music.sharedName());
            a.put("musicHidden", music.verdict() != null && !"ok".equals(music.verdict()) ? music.verdict() : JSONObject.NULL);
            String bridge = bridgeDiag == null ? "waiting" : (bridgeDiag.optBoolean("dispatcher") ? "ready" : "partial");
            a.put("bridge", bridge);
            a.put("sharingOff", bridgeDiag != null && bridgeDiag.has("showCurrentGame")
                    && !bridgeDiag.isNull("showCurrentGame") && !bridgeDiag.optBoolean("showCurrentGame", true));
        } catch (Exception ignored) {}
        return a;
    }

    void refreshMusic() { music.refresh(); }

    void pickWallpaper(StudioSheet.Callback cb) {
        pendingWallCallback = cb;
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
        try { startActivityForResult(i, RC_WALL); } catch (Exception e) { pendingWallCallback = null; cb.done(null); }
    }

    private void importWallpaper(Uri uri) {
        new Thread(() -> {
            String path = null, name = null;
            try {
                name = displayName(uri);
                if (name == null) name = "duvar-kagidi";
                name = name.replaceAll("[^\\w.\\-]+", "_");
                File dir = new File(getFilesDir(), "wallpaper");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                dir.mkdirs();
                File out = new File(dir, name);
                try (InputStream in = getContentResolver().openInputStream(uri); OutputStream o = new FileOutputStream(out)) {
                    byte[] b = new byte[65536];
                    int n;
                    while ((n = in.read(b)) > 0) o.write(b, 0, n);
                }
                path = out.getAbsolutePath();
            } catch (Exception e) {
                EnexLog.d("wall", "kopyalanamadı: " + e);
            }
            final String p = path, nm = name;
            main.post(() -> {
                if (p != null) {
                    JSONObject patch = new JSONObject();
                    try {
                        patch.put("wallpaper", p);
                        patch.put("wallpaperName", nm);
                        patch.put("theme", "anime");
                    } catch (Exception ignored) {}
                    onSettingsChanged(settings.update(patch));
                }
                if (pendingWallCallback != null) { pendingWallCallback.done(null); pendingWallCallback = null; }
            });
        }, "enex-wall").start();
    }

    private String displayName(Uri uri) {
        try (android.database.Cursor c = getContentResolver().query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return null;
    }

    /* ---------------- İzinler ---------------- */

    private void handlePermission(PermissionRequest req) {
        List<String> need = new ArrayList<>();
        List<String> res = new ArrayList<>();
        for (String r : req.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) { res.add(r); need.add(Manifest.permission.RECORD_AUDIO); }
            else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) { res.add(r); need.add(Manifest.permission.CAMERA); }
        }
        if (res.isEmpty() || !ORIGINS.contains(originOf(req.getOrigin()))) { req.deny(); return; }
        List<String> missing = new ArrayList<>();
        for (String p : need) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        if (missing.isEmpty()) { req.grant(res.toArray(new String[0])); return; }
        if (pendingPermission != null) pendingPermission.deny();
        pendingPermission = req;
        requestPermissions(missing.toArray(new String[0]), RC_MEDIA);
    }

    private static String originOf(Uri u) {
        if (u == null) return "";
        return u.getScheme() + "://" + u.getHost();
    }

    private void askNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        if (getSharedPreferences("enex", MODE_PRIVATE).getBoolean("askedNotif", false)) return;
        getSharedPreferences("enex", MODE_PRIVATE).edit().putBoolean("askedNotif", true).apply();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, RC_NOTIF);
    }

    void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, RC_NOTIF);
            return;
        }
        // Daha önce reddedildiyse ya da kanal kapalıysa: uygulamanın bildirim ayarları
        Intent i = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName());
        try { startActivity(i); } catch (Exception ignored) {}
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == RC_MEDIA && pendingPermission != null) {
            PermissionRequest req = pendingPermission;
            pendingPermission = null;
            List<String> grant = new ArrayList<>();
            for (String r : req.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grant.add(r);
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grant.add(r);
            }
            if (grant.isEmpty()) {
                req.deny();
                Toast.makeText(this, I18n.t("perm.mic"), Toast.LENGTH_LONG).show();
            } else {
                req.grant(grant.toArray(new String[0]));
                // Mikrofon izni geldiyse servis mikrofon türüyle yeniden başlasın (ekran kapalıyken ses)
                if (settings.bool("keepAlive")) KeepAliveService.start(this);
            }
        }
        if (code == RC_NOTIF && studio != null) studio.pushState();
    }

    /* ---------------- İndirme ---------------- */

    private void onDownload(String url, String cd, String mime) {
        if (url.startsWith("blob:")) {
            String name = android.webkit.URLUtil.guessFileName(url, cd, mime);
            web.evaluateJavascript("window.__enexSaveBlob && window.__enexSaveBlob(" + Util.jsString(url) + "," + Util.jsString(name) + ")", null);
            return;
        }
        if (!url.startsWith("http")) return;
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, RC_STORAGE);
            return;
        }
        downloader.download(url, userAgent, cd, mime);
    }

    /* ---------------- Etkinlik sonuçları ---------------- */

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == RC_FILE) {
            if (fileCallback == null) return;
            Uri[] uris = null;
            if (result == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    uris = new Uri[clip.getItemCount()];
                    for (int i = 0; i < clip.getItemCount(); i++) uris[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    uris = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(uris);
            fileCallback = null;
        } else if (code == RC_WALL) {
            if (result == RESULT_OK && data != null && data.getData() != null) importWallpaper(data.getData());
            else if (pendingWallCallback != null) { pendingWallCallback.done(null); pendingWallCallback = null; }
        }
    }

    /* ---------------- Gezinme ---------------- */

    private static String urlFromIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return null;
        Uri u = intent.getData();
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        String path = u.getPath() == null ? "" : u.getPath();
        if (host.equals("discord.gg") && path.length() > 1) return "https://discord.com/invite" + path;
        if (host.equals("discord.com") || host.endsWith(".discord.com") || host.equals("discordapp.com")) {
            return "https://discord.com" + path + (u.getQuery() != null ? "?" + u.getQuery() : "");
        }
        return null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (KeepAliveService.ACTION_QUIT.equals(intent.getAction())) { quit(); return; }
        int notif = intent.getIntExtra(Notifier.EXTRA_NOTIF, 0);
        if (notif > 0) {
            try {
                JSONObject m = new JSONObject();
                m.put("t", "notif-click");
                m.put("id", notif);
                sendToPage(m);
            } catch (Exception ignored) {}
            return;
        }
        String u = urlFromIntent(intent);
        if (u != null && web != null) web.loadUrl(u);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) { hideCustomView(); return; }
        if (studio != null && studio.isOpen()) { studio.close(); return; }
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("window.__enexBack ? window.__enexBack() : 'none'", r -> {
            if (r != null && !r.contains("none")) return;
            if (settings.bool("keepAlive")) {
                if (!getSharedPreferences("enex", MODE_PRIVATE).getBoolean("exitHint", false)) {
                    getSharedPreferences("enex", MODE_PRIVATE).edit().putBoolean("exitHint", true).apply();
                    Toast.makeText(this, I18n.t("exit.hint"), Toast.LENGTH_LONG).show();
                }
                moveTaskToBack(true);
            } else {
                finish();
            }
        });
    }

    private void quit() {
        KeepAliveService.stop(this);
        unblocker.shutdown();
        finishAndRemoveTask();
    }

    /* ---------------- Yaşam döngüsü ---------------- */

    @Override
    protected void onStart() {
        super.onStart();
        if (web != null) web.onResume();
        if (music != null) music.refresh();
        if (studio != null) studio.pushState();
    }

    @Override
    protected void onStop() {
        // onPause: sayfa "gizli" olur (Discord bildirim göstersin), ama JS durmaz (bağlantı sürer)
        if (web != null) web.onPause();
        super.onStop();
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        // Döndürme vb.: genişlik değişirse addOnLayoutChangeListener durumu yeniden gönderir
    }

    @Override
    protected void onDestroy() {
        if (isFinishing() && !isChangingConfigurations() && settings != null) {
            KeepAliveService.stop(this);
            unblocker.shutdown();
        }
        if (web != null) {
            unblocker.setListener(null);
            web.stopLoading();
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
