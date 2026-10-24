package com.enevolex.enex;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Discord sayfasına gönderilen durum: tema CSS'i, bayraklar, duvar kağıdı, görüntü alanı.
 * (masaüstündeki applyTheme + alphaCss + wallpaperState'in karşılığı)
 */
public final class PageState {
    public static final String WALL_PATH = "/__enex/wall/";
    private static final String[] VIDEO_EXT = {"mp4", "webm", "mkv", "mov", "m4v"};
    private static final Map<String, String> cssCache = new HashMap<>();

    private PageState() {}

    static String asset(Context ctx, String path) {
        synchronized (cssCache) {
            String c = cssCache.get(path);
            if (c != null) return c;
            try (InputStream in = ctx.getAssets().open(path)) {
                c = new String(Util.readAll(in), "UTF-8");
            } catch (Exception e) {
                EnexLog.d("theme", "okunamadı " + path + ": " + e);
                c = "";
            }
            cssCache.put(path, c);
            return c;
        }
    }

    static String alphaCss(Settings s) {
        String theme = s.theme();
        if ("glass".equals(theme)) {
            double g = Util.clamp(s.num("glassAlpha"), 0, 0.9);
            return "html:root {"
                    + "--nx-bg-rail: rgba(8, 8, 12, " + f2(g + 0.02) + ") !important;"
                    + "--nx-bg-side: rgba(8, 8, 12, " + f2(g) + ") !important;"
                    + "--nx-bg-chat: rgba(8, 8, 12, " + f2(g) + ") !important;"
                    + "--nx-bg-input: rgba(8, 8, 12, " + f2(g + 0.08) + ") !important; }";
        }
        if ("anime".equals(theme)) {
            double a = s.num("animeAlpha");
            String rgb = "14, 10, 32";
            return "html:root {"
                    + "--nx-bg-rail: rgba(" + rgb + ", " + f2(a + 0.1) + ") !important;"
                    + "--nx-bg-side: rgba(" + rgb + ", " + f2(a) + ") !important;"
                    + "--nx-bg-chat: rgba(" + rgb + ", " + f2(a - 0.08) + ") !important;"
                    + "--nx-bg-input: rgba(" + rgb + ", " + f2(a + 0.15) + ") !important; }";
        }
        return null;
    }

    private static String f2(double x) {
        return String.format(Locale.US, "%.2f", Util.clamp(x, 0, 0.97));
    }

    public static boolean isVideo(String name) {
        String n = name == null ? "" : name.toLowerCase(Locale.ROOT);
        for (String e : VIDEO_EXT) if (n.endsWith("." + e)) return true;
        return false;
    }

    /** Hazır duvar kağıdı: wallpapers/varsayilan.* varsa o, yoksa Sakura Gecesi (SVG). */
    public static String bundledWallpaper(Context ctx, boolean fx) {
        try {
            String[] list = ctx.getAssets().list("wallpapers");
            if (list != null) {
                for (String n : list) {
                    if (n.toLowerCase(Locale.ROOT).matches("^varsayilan\\.(mp4|webm|jpe?g|png|webp|gif)$")) return "wallpapers/" + n;
                }
            }
        } catch (Exception ignored) {}
        return fx ? "wallpapers/sakura-gecesi.svg" : "wallpapers/sakura-gecesi-static.svg";
    }

    static JSONObject wallpaper(Context ctx, Settings s) throws Exception {
        if (!"anime".equals(s.theme())) return null;
        String file = s.wallpaper();
        String name;
        long ver;
        if (file != null && new File(file).exists()) {
            name = new File(file).getName();
            ver = new File(file).lastModified();
        } else {
            name = bundledWallpaper(ctx, s.bool("fx"));
            name = name.substring(name.lastIndexOf('/') + 1);
            ver = BuildConfig.VERSION_CODE;
        }
        JSONObject w = new JSONObject();
        w.put("src", WALL_PATH + android.net.Uri.encode(name) + "?v=" + ver);
        w.put("kind", isVideo(name) ? "video" : "image");
        w.put("dim", s.num("wallDim"));
        w.put("paused", !s.bool("fx"));
        w.put("kenburns", true);
        return w;
    }

    /**
     * @param widthDp WebView'ın genişliği (dp). Mobil düzende sayfa genişliği = widthDp / ölçek.
     */
    public static JSONObject build(Context ctx, Settings s, int widthDp) {
        JSONObject o = new JSONObject();
        try {
            String theme = s.theme();
            boolean mobile = "mobile".equals(s.str("layout"));
            StringBuilder css = new StringBuilder();
            css.append(asset(ctx, "themes/core.css")).append('\n');
            css.append(asset(ctx, "themes/" + theme + ".css")).append('\n');
            css.append(asset(ctx, "themes/motion.css")).append('\n');
            css.append(asset(ctx, "page/mobile.css")).append('\n');
            String a = alphaCss(s);
            if (a != null) css.append(a).append('\n');
            String accent = s.str("accent");
            if (Util.isHex(accent)) {
                css.append("html:root { --nx-accent: ").append(accent).append(" !important; --nx-glow: ")
                        .append(accent).append("aa !important; }\n");
            }
            o.put("t", "state");
            o.put("css", css.toString());
            o.put("theme", theme);
            JSONObject flags = new JSONObject();
            flags.put("fx", s.bool("fx"));
            flags.put("cards", s.bool("cards"));
            flags.put("clean", s.bool("clean"));
            o.put("flags", flags);
            JSONObject view = new JSONObject();
            view.put("mode", mobile ? "mobile" : "desktop");
            int w = Math.max(280, widthDp);
            if (mobile) view.put("width", (int) Math.round(w / Util.clamp(s.num("uiScale"), 0.6, 1.2)));
            else view.put("width", Math.max(1100, w));
            o.put("view", view);
            JSONObject wall = wallpaper(ctx, s);
            o.put("wall", wall == null ? JSONObject.NULL : wall);
            JSONObject labels = new JSONObject();
            labels.put("volWarn", I18n.t("vol.warn"));
            labels.put("volDanger", I18n.t("vol.danger"));
            o.put("labels", labels);
        } catch (Exception e) {
            EnexLog.d("theme", "durum oluşturulamadı: " + e);
        }
        return o;
    }
}
