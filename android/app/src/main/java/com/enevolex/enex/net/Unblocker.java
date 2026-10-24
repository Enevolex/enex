package com.enevolex.enex.net;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;

import com.enevolex.enex.EnexLog;
import com.enevolex.enex.I18n;
import com.enevolex.enex.Settings;
import com.enevolex.enex.Util;

import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * ENGEL AŞMA (masaüstündeki applyNetwork/findMethod'un karşılığı).
 * Yöntemler sırayla denenir; Discord'a ulaşabilen ilki kullanılır ve hatırlanır.
 * Sadece Enex'in WebView'ı yönlendirilir (androidx.webkit ProxyController); telefonun
 * geri kalanı etkilenmez.
 */
public final class Unblocker {
    public interface Listener {
        void onProgress(String text);
        void onStatus();
    }

    static final class Method {
        final String id;
        final String[] args; // null = proxy yok, sadece şifreli DNS
        Method(String id, String... args) { this.id = id; this.args = args.length == 0 ? null : args; }
    }

    static final Method[] METHODS = {
            new Method("dns"),
            new Method("sd", "--split", "1+s", "--disorder", "3+s"),
            new Method("tlsrec", "--tlsrec", "3+s", "--split", "1+s", "--disorder", "3+s"),
            new Method("fake5", "--disorder", "1", "--fake", "-1", "--ttl", "5"),
            new Method("fake3", "--disorder", "1", "--fake", "-1", "--ttl", "3"),
            new Method("fake8", "--disorder", "1", "--fake", "-1", "--ttl", "8"),
            new Method("oob", "--oob", "3+s", "--disorder", "1+s"),
            new Method("disoob", "--disoob", "3+s", "--split", "1+s"),
            new Method("sni", "--split", "0+sm", "--disorder", "0+se", "--tlsrec", "0+sm"),
            new Method("mix", "--split", "1+s", "--disorder", "3+s", "--fake", "-1", "--ttl", "5", "--tlsrec", "3+s")
    };
    static final String[] PROBE_URLS = {"https://gateway.discord.gg/?v=10&encoding=json", "https://discord.com/api/v10/gateway"};

    private final Context ctx;
    private final Settings settings;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "enex-unblock");
        t.setDaemon(true);
        return t;
    });
    private final DohResolver resolver = new DohResolver(true);
    private Listener listener;

    // Etkin bağlantı
    private volatile FrontProxy front;
    private volatile Ciadpi ciadpi;
    private volatile String[] activeArgs;
    private int restarts;

    // Durum (dil değişince yeniden çevrilebilsin diye anahtar olarak)
    private volatile String state = "off";
    private volatile String key = "dpi.off";
    private volatile String method;
    private volatile int searchI, searchN;
    private volatile boolean searching;
    private volatile boolean missingBin;

    /** Ana iş parçacığında bir kez ölçülür (WebView özellik sorguları oradan yapılmalı). */
    public static volatile boolean proxySupported = true;

    public Unblocker(Context ctx, Settings settings) {
        this.ctx = ctx.getApplicationContext();
        this.settings = settings;
    }

    public void setListener(Listener l) { listener = l; }

    public boolean searching() { return searching; }

    /** Discord'a giden istekler için kullanılacak proxy (ana belge isteği vb.). */
    public Proxy javaProxy() {
        FrontProxy f = front;
        return f == null ? Proxy.NO_PROXY : new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", f.port()));
    }

    public JSONObject view() {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            String m;
            if ("dpi.searching".equals(key)) m = I18n.t(key, Util.vars("i", String.valueOf(searchI), "n", String.valueOf(searchN)));
            else if ("dpi.on".equals(key)) m = I18n.t(key, Util.vars("method", I18n.t("dpi.m." + method)));
            else m = I18n.t(key);
            o.put("message", m);
        } catch (Exception ignored) {}
        return o;
    }

    private void status(String st, String k) {
        state = st;
        key = k;
        main.post(() -> { if (listener != null) listener.onStatus(); });
    }

    private void progress(String text) {
        main.post(() -> { if (listener != null) listener.onProgress(text); });
    }

    /** Bağlantıyı kur. done ana iş parçacığında, WebView yeni ayarla yükleme yapabilecekken çağrılır. */
    public void apply(boolean forceSearch, Runnable done) {
        worker.execute(() -> {
            searching = true;
            try {
                stopAll();
                restarts = 0;
                if (!settings.bool("dpiEnabled")) {
                    status("off", "dpi.off");
                    setWebViewProxy(0, done);
                    return;
                }
                if (!proxySupported) {
                    EnexLog.d("dpi", "WebView proxy desteklemiyor");
                    status("error", "dpi.failed");
                    setWebViewProxy(0, done);
                    return;
                }
                Found f = findMethod(forceSearch);
                if (f == null) {
                    status("error", missingBin ? "dpi.missing" : "dpi.failed");
                    setWebViewProxy(0, done);
                    return;
                }
                settings.putQuiet("dpiMethod", f.method.id);
                front = f.front;
                ciadpi = f.ciadpi;
                activeArgs = f.method.args;
                method = f.method.id;
                if (ciadpi != null) watch(ciadpi);
                EnexLog.d("dpi", "yöntem: " + f.method.id + " · proxy 127.0.0.1:" + f.front.port());
                status("on", "dpi.on");
                setWebViewProxy(f.front.port(), done);
            } catch (Throwable t) {
                EnexLog.d("dpi", "hata: " + t);
                status("error", "dpi.failed");
                setWebViewProxy(0, done);
            } finally {
                searching = false;
            }
        });
    }

    private static final class Found {
        final Method method;
        final FrontProxy front;
        final Ciadpi ciadpi;
        Found(Method m, FrontProxy f, Ciadpi c) { method = m; front = f; ciadpi = c; }
    }

    private Found findMethod(boolean forceSearch) {
        List<Method> ordered = new ArrayList<>();
        for (Method m : METHODS) ordered.add(m);
        String last = settings.str("dpiMethod");
        if (last != null && !forceSearch) {
            for (int i = 0; i < ordered.size(); i++) {
                if (ordered.get(i).id.equals(last)) { ordered.add(0, ordered.remove(i)); break; }
            }
        }
        searchN = ordered.size();
        missingBin = false;
        for (int i = 0; i < ordered.size(); i++) {
            Method m = ordered.get(i);
            searchI = i + 1;
            status("search", "dpi.searching");
            progress(I18n.t("loading.search", Util.vars("i", String.valueOf(i + 1), "n", String.valueOf(ordered.size()), "name", I18n.t("dpi.m." + m.id))));
            Ciadpi c = null;
            FrontProxy f = null;
            try {
                if (m.args != null) c = Ciadpi.start(ctx, m.args);
                f = new FrontProxy(resolver, c == null ? -1 : c.port(), msg -> EnexLog.d("proxy", msg));
                if (probe(f.port(), 6000)) return new Found(m, f, c);
            } catch (Ciadpi.MissingException e) {
                EnexLog.d("dpi", "ciadpi bulunamadı: " + Ciadpi.binary(ctx));
                if (f != null) f.close();
                missingBin = true;
                continue;
            } catch (Exception e) {
                EnexLog.d("dpi", m.id + ": " + e.getMessage());
            }
            if (f != null) f.close();
            if (c != null) c.stop();
        }
        return null;
    }

    /** İki adres de herhangi bir HTTP yanıtı verirse Discord'a ulaşılıyor demektir. */
    static boolean probe(int proxyPort, int timeoutMs) {
        Proxy p = new Proxy(Proxy.Type.HTTP, new InetSocketAddress("127.0.0.1", proxyPort));
        for (String u : PROBE_URLS) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(u).openConnection(p);
                c.setConnectTimeout(timeoutMs);
                c.setReadTimeout(timeoutMs);
                c.setUseCaches(false);
                c.setInstanceFollowRedirects(false);
                c.getResponseCode();
            } catch (Exception e) {
                return false;
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return true;
    }

    /** Stüdyodaki "Bağlantıyı test et". */
    public JSONObject test() {
        long t0 = System.currentTimeMillis();
        JSONObject o = new JSONObject();
        boolean ok;
        String err = "";
        FrontProxy f = front;
        if (f != null) {
            ok = probe(f.port(), 8000);
        } else {
            ok = true;
            for (String u : PROBE_URLS) {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(u).openConnection();
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(8000);
                    c.getResponseCode();
                } catch (Exception e) {
                    ok = false;
                    err = String.valueOf(e.getMessage());
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }
        try {
            o.put("ok", ok);
            o.put("message", ok ? I18n.t("dpi.reached", Util.vars("ms", String.valueOf(System.currentTimeMillis() - t0)))
                    : I18n.t("dpi.unreachable", Util.vars("err", err.isEmpty() ? "timeout" : err)));
        } catch (Exception ignored) {}
        return o;
    }

    // ciadpi çökerse en fazla 3 kez yeniden başlat (masaüstüyle aynı)
    private void watch(Ciadpi c) {
        Thread t = new Thread(() -> {
            try { c.process().waitFor(); } catch (InterruptedException e) { return; }
            if (ciadpi != c) return;
            EnexLog.d("dpi", "ciadpi durdu");
            status("error", "dpi.stopped");
            if (restarts++ >= 3) return;
            worker.execute(() -> {
                if (ciadpi != c || activeArgs == null) return;
                try {
                    Thread.sleep(1000);
                    Ciadpi n = Ciadpi.start(ctx, activeArgs);
                    FrontProxy nf = new FrontProxy(resolver, n.port(), msg -> EnexLog.d("proxy", msg));
                    FrontProxy old = front;
                    ciadpi = n;
                    front = nf;
                    if (old != null) old.close();
                    watch(n);
                    status("on", "dpi.on");
                    setWebViewProxy(nf.port(), null);
                } catch (Exception e) {
                    EnexLog.d("dpi", "yeniden başlatılamadı: " + e.getMessage());
                    status("error", "dpi.failed");
                }
            });
        }, "ciadpi-watch");
        t.setDaemon(true);
        t.start();
    }

    private void setWebViewProxy(int port, Runnable done) {
        main.post(() -> {
            Runnable fin = () -> { if (done != null) done.run(); };
            try {
                if (!proxySupported) { fin.run(); return; }
                if (port > 0) {
                    ProxyConfig cfg = new ProxyConfig.Builder().addProxyRule("127.0.0.1:" + port).build();
                    ProxyController.getInstance().setProxyOverride(cfg, main::post, fin);
                } else {
                    ProxyController.getInstance().clearProxyOverride(main::post, fin);
                }
            } catch (Exception e) {
                EnexLog.d("dpi", "WebView proxy ayarlanamadı: " + e);
                fin.run();
            }
        });
    }

    private void stopAll() {
        Ciadpi c = ciadpi;
        FrontProxy f = front;
        ciadpi = null;
        front = null;
        activeArgs = null;
        if (c != null) c.stop();
        if (f != null) f.close();
    }

    public void shutdown() {
        worker.execute(this::stopAll);
    }
}
