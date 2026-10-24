package com.enevolex.enex;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import com.enevolex.enex.net.Unblocker;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * WebView isteklerini yakalar:
 *  1) discord.com/__enex/wall/... → seçili duvar kağıdı (masaüstündeki enex:// protokolü).
 *     Aynı kökenden geldiği için Discord'un CSP'sine takılmaz. Videolar için Range desteklenir.
 *  2) Discord'un ana sayfası → CSP'ye sadece 'unsafe-eval' eklenir (%300 ses için; masaüstü,
 *     Vencord ve Vesktop ile aynı). Başka hiçbir kural değişmez; bir şey ters giderse WebView
 *     sayfayı kendisi yükler.
 */
public final class Interceptor {
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");
    private final Context ctx;
    private final Settings settings;
    private final Unblocker unblocker;
    private volatile String userAgent;

    public void setUserAgent(String ua) { userAgent = ua; }

    public Interceptor(Context ctx, Settings settings, Unblocker unblocker) {
        this.ctx = ctx.getApplicationContext();
        this.settings = settings;
        this.unblocker = unblocker;
    }

    public static boolean isDiscordHost(String host) {
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals("discord.com") || host.equals("ptb.discord.com") || host.equals("canary.discord.com");
    }

    public WebResourceResponse intercept(WebResourceRequest req) {
        Uri u = req.getUrl();
        if (!"https".equals(u.getScheme()) || !isDiscordHost(u.getHost())) return null;
        String path = u.getPath() == null ? "" : u.getPath();
        if (path.startsWith(PageState.WALL_PATH)) return wallpaper(req);
        if (req.isForMainFrame() && "GET".equalsIgnoreCase(req.getMethod()) && !path.startsWith("/api/")
                && !path.startsWith("/assets/") && !path.startsWith("/__")) {
            return mainDocument(req);
        }
        return null;
    }

    /* ---------------- Duvar kağıdı ---------------- */
    private WebResourceResponse wallpaper(WebResourceRequest req) {
        try {
            String file = settings.wallpaper();
            String name;
            long length;
            InputStream in;
            if (file != null && "anime".equals(settings.theme()) && new File(file).exists()) {
                File f = new File(file);
                name = f.getName();
                length = f.length();
                in = new FileInputStream(f);
            } else {
                String asset = PageState.bundledWallpaper(ctx, settings.bool("fx"));
                name = asset;
                AssetFileDescriptor fd = null;
                try { fd = ctx.getAssets().openFd(asset); } catch (IOException compressed) { /* sıkıştırılmış varlık */ }
                if (fd != null) {
                    length = fd.getLength();
                    in = fd.createInputStream();
                } else {
                    byte[] all;
                    try (InputStream ain = ctx.getAssets().open(asset)) { all = Util.readAll(ain); }
                    length = all.length;
                    in = new ByteArrayInputStream(all);
                }
            }
            String mime = mimeOf(name);
            Map<String, String> h = new HashMap<>();
            h.put("Accept-Ranges", "bytes");
            h.put("Cache-Control", "no-cache");
            String range = header(req, "Range");
            Matcher m = range == null ? null : RANGE.matcher(range);
            if (m != null && m.find() && length > 0) {
                long start, end;
                if (m.group(1).isEmpty()) { // son N bayt
                    long n = Long.parseLong(m.group(2));
                    start = Math.max(0, length - n);
                    end = length - 1;
                } else {
                    start = Long.parseLong(m.group(1));
                    end = m.group(2).isEmpty() ? length - 1 : Math.min(Long.parseLong(m.group(2)), length - 1);
                }
                if (start >= length || start > end) {
                    in.close();
                    h.put("Content-Range", "bytes */" + length);
                    return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
                }
                skipFully(in, start);
                long len = end - start + 1;
                h.put("Content-Range", "bytes " + start + "-" + end + "/" + length);
                h.put("Content-Length", String.valueOf(len));
                return new WebResourceResponse(mime, null, 206, "Partial Content", h, new Limited(in, len));
            }
            h.put("Content-Length", String.valueOf(length));
            return new WebResourceResponse(mime, null, 200, "OK", h, in);
        } catch (Exception e) {
            EnexLog.d("wall", "duvar kağıdı verilemedi: " + e);
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
        }
    }

    static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".mkv")) return "video/x-matroska";
        if (n.endsWith(".mov")) return "video/quicktime";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".avif")) return "image/avif";
        if (n.endsWith(".bmp")) return "image/bmp";
        if (n.endsWith(".svg")) return "image/svg+xml";
        return "image/jpeg";
    }

    private static void skipFully(InputStream in, long n) throws IOException {
        while (n > 0) {
            long s = in.skip(n);
            if (s <= 0) {
                if (in.read() < 0) return;
                s = 1;
            }
            n -= s;
        }
    }

    private static final class Limited extends FilterInputStream {
        private long left;
        Limited(InputStream in, long n) { super(in); left = n; }
        @Override public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int r = super.read(b, off, (int) Math.min(len, left));
            if (r > 0) left -= r;
            return r;
        }
    }

    private static String header(WebResourceRequest req, String name) {
        Map<String, String> h = req.getRequestHeaders();
        if (h == null) return null;
        for (Map.Entry<String, String> e : h.entrySet()) if (e.getKey().equalsIgnoreCase(name)) return e.getValue();
        return null;
    }

    /* ---------------- Ana belge: CSP'ye 'unsafe-eval' ---------------- */
    private WebResourceResponse mainDocument(WebResourceRequest req) {
        HttpURLConnection c = null;
        String url = req.getUrl().toString();
        try {
            c = (HttpURLConnection) new URL(url).openConnection(unblocker.javaProxy());
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(12000);
            c.setReadTimeout(15000);
            c.setUseCaches(false);
            Map<String, String> rh = req.getRequestHeaders();
            if (rh != null) {
                for (Map.Entry<String, String> e : rh.entrySet()) {
                    String k = e.getKey();
                    if (k.equalsIgnoreCase("Accept-Encoding") || k.equalsIgnoreCase("Range")) continue;
                    c.setRequestProperty(k, e.getValue());
                }
            }
            if (userAgent != null) c.setRequestProperty("User-Agent", userAgent);
            CookieManager cm = CookieManager.getInstance();
            String cookie = cm.getCookie(url);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            int code = c.getResponseCode();
            String ct = c.getContentType();
            if (code != 200 || ct == null || !ct.toLowerCase(Locale.ROOT).startsWith("text/html")) {
                return null; // yönlendirme, hata ya da başka içerik: WebView kendisi halletsin
            }
            Map<String, List<String>> fields = c.getHeaderFields();
            List<String> setCookies = null;
            Map<String, String> out = new HashMap<>();
            for (Map.Entry<String, List<String>> e : fields.entrySet()) {
                String k = e.getKey();
                if (k == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                String lk = k.toLowerCase(Locale.ROOT);
                if (lk.equals("set-cookie")) { setCookies = e.getValue(); continue; }
                if (lk.equals("content-encoding") || lk.equals("content-length") || lk.equals("transfer-encoding")
                        || lk.equals("connection") || lk.equals("content-type") || lk.startsWith("x-android")) continue;
                String v = String.join(", ", e.getValue());
                if (lk.equals("content-security-policy") || lk.equals("content-security-policy-report-only")) v = allowEval(v);
                out.put(k, v);
            }
            if (setCookies != null) {
                for (String sc : setCookies) cm.setCookie(url, sc);
                cm.flush();
            }
            String charset = "utf-8";
            Matcher cs = Pattern.compile("charset=([\\w-]+)", Pattern.CASE_INSENSITIVE).matcher(ct);
            if (cs.find()) charset = cs.group(1);
            byte[] body;
            try (InputStream in = c.getInputStream()) { body = Util.readAll(in); }
            return new WebResourceResponse("text/html", charset, 200, "OK", out, new ByteArrayInputStream(body));
        } catch (Exception e) {
            EnexLog.d("csp", "ana sayfa yakalanamadı, WebView yüklüyor: " + e.getClass().getSimpleName());
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** script-src kuralına 'unsafe-eval' ekle (yoksa default-src'yi temel alır). Masaüstüyle aynı. */
    static String allowEval(String csp) {
        String[] parts = csp.split(";");
        StringBuilder out = new StringBuilder();
        boolean hasScript = false;
        String def = null;
        java.util.List<String> list = new java.util.ArrayList<>();
        for (String p : parts) {
            String t = p.trim();
            if (t.isEmpty()) continue;
            if (t.matches("(?i)^script-src(\\s.*)?$")) {
                hasScript = true;
                if (!t.contains("'unsafe-eval'")) t += " 'unsafe-eval'";
            }
            if (t.matches("(?i)^default-src(\\s.*)?$")) def = t;
            list.add(t);
        }
        if (!hasScript && def != null && !def.contains("'unsafe-eval'")) {
            list.add(def.replaceFirst("(?i)^default-src", "script-src") + " 'unsafe-eval'");
        }
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) out.append("; ");
            out.append(list.get(i));
        }
        return out.toString();
    }
}
