package com.enevolex.enex;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.File;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** Ayarlar (masaüstündeki enex-settings.json'un karşılığı). Tüm erişimler senkronize. */
public final class Settings {
    public static final List<String> THEMES = Arrays.asList(
            "aurora", "anime", "glass", "neon-tokyo", "synthwave", "abyss", "obsidian", "matrix");
    /** Her tema: [arka plan, vurgu, vurgu 2, vurgu 3] (masaüstündeki THEMES listesi). */
    public static final String[][] COLORS = {
            {"#07060f", "#8b5cf6", "#ec4899", "#22d3ee"},
            {"#2a1b5e", "#ff8fb8", "#ffd27a", "#9fe7ff"},
            {"#3b4a5e", "#9ad8ff", "#ffffff", "#d5dae4"},
            {"#050508", "#f5e100", "#ff2a6d", "#00f0ff"},
            {"#1e0540", "#ff3cac", "#ffb547", "#2de2e6"},
            {"#021422", "#2dd4bf", "#38bdf8", "#a5f3fc"},
            {"#09090a", "#d4b06a", "#e8cf98", "#f6f1e6"},
            {"#000000", "#00ff66", "#b6ff00", "#b8ffcf"}
    };

    private static Settings inst;
    private final SharedPreferences prefs;
    private JSONObject s;

    private Settings(Context ctx) {
        prefs = ctx.getSharedPreferences("enex", Context.MODE_PRIVATE);
        s = defaults();
        try {
            JSONObject saved = new JSONObject(prefs.getString("settings", "{}"));
            Iterator<String> it = saved.keys();
            while (it.hasNext()) {
                String k = it.next();
                s.put(k, saved.get(k));
            }
        } catch (Exception ignored) {}
        if (!THEMES.contains(s.optString("theme"))) put("theme", "aurora");
        String w = wallpaper();
        if (w != null && !new File(w).exists()) { put("wallpaper", JSONObject.NULL); put("wallpaperName", JSONObject.NULL); }
    }

    public static synchronized Settings get(Context ctx) {
        if (inst == null) inst = new Settings(ctx.getApplicationContext());
        return inst;
    }

    private static JSONObject defaults() {
        JSONObject d = new JSONObject();
        try {
            d.put("theme", "aurora");
            d.put("fx", true);
            d.put("cards", true);
            d.put("clean", true);
            d.put("accent", JSONObject.NULL);
            d.put("glassMode", "clear");   // 'acrylic' = bulanık, 'clear' = net
            d.put("glassAlpha", 0.18);     // telefonda duvar kağıtları parlak olabilir: biraz daha koyu
            d.put("animeAlpha", 0.38);
            d.put("wallDim", 0.2);
            d.put("wallpaper", JSONObject.NULL);
            d.put("wallpaperName", JSONObject.NULL);
            d.put("dpiEnabled", true);
            d.put("dpiMethod", JSONObject.NULL);
            d.put("lang", "auto");
            d.put("layout", "mobile");     // 'mobile' | 'desktop'
            d.put("uiScale", 0.9);         // mobil düzende arayüz boyutu
            d.put("notify", true);
            d.put("keepAlive", true);
            d.put("activityMusic", true);
            d.put("musicSources", "smart");
            d.put("musicBlock", "");
            d.put("fabX", -1);
            d.put("fabY", -1);
            d.put("version", 1);
        } catch (Exception ignored) {}
        return d;
    }

    private void put(String k, Object v) {
        try { s.put(k, v); } catch (Exception ignored) {}
    }

    private void save() {
        prefs.edit().putString("settings", s.toString()).apply();
    }

    public synchronized JSONObject json() {
        try { return new JSONObject(s.toString()); } catch (Exception e) { return new JSONObject(); }
    }

    public synchronized String str(String k) {
        Object v = s.opt(k);
        return v == null || v == JSONObject.NULL ? null : String.valueOf(v);
    }
    public synchronized boolean bool(String k) { return s.optBoolean(k, false); }
    public synchronized double num(String k) { return s.optDouble(k, 0); }

    public String theme() { return str("theme"); }
    public String wallpaper() { return str("wallpaper"); }

    public static String[] colors(String theme) {
        int i = THEMES.indexOf(theme);
        return COLORS[i < 0 ? 0 : i];
    }

    /** Kaydedilen ama değişikliği kimseye bildirilmeyen ayar (yöntem, düğme yeri). */
    public synchronized void putQuiet(String k, Object v) {
        put(k, v == null ? JSONObject.NULL : v);
        save();
    }

    /** Stüdyodan gelen değişiklik. Değişen anahtarları döndürür. */
    public synchronized Set<String> update(JSONObject patch) {
        Set<String> changed = new HashSet<>();
        if (patch == null) return changed;
        Iterator<String> it = patch.keys();
        while (it.hasNext()) {
            String k = it.next();
            Object v = patch.opt(k);
            Object nv = sanitize(k, v);
            if (nv == INVALID) continue;
            Object old = s.opt(k);
            if (old != null && String.valueOf(old).equals(String.valueOf(nv))) continue;
            put(k, nv);
            changed.add(k);
        }
        if (!changed.isEmpty()) save();
        return changed;
    }

    private static final Object INVALID = new Object();

    private Object sanitize(String k, Object v) {
        switch (k) {
            case "theme": return THEMES.contains(String.valueOf(v)) ? v : INVALID;
            case "lang": return Arrays.asList("auto", "tr", "en").contains(String.valueOf(v)) ? v : INVALID;
            case "fx": case "cards": case "clean": case "dpiEnabled": case "notify": case "keepAlive": case "activityMusic":
                return v instanceof Boolean ? v : Boolean.parseBoolean(String.valueOf(v));
            case "accent": return v instanceof String && Util.isHex((String) v) ? v : JSONObject.NULL;
            case "glassMode": return "acrylic".equals(v) || "clear".equals(v) ? v : INVALID;
            case "glassAlpha": case "animeAlpha": return Util.clamp(toD(v), 0, 0.9);
            case "wallDim": return Util.clamp(toD(v), 0, 0.85);
            case "uiScale": return Util.clamp(toD(v), 0.6, 1.2);
            case "layout": return "mobile".equals(v) || "desktop".equals(v) ? v : INVALID;
            case "musicSources": return Arrays.asList("music", "smart", "all").contains(String.valueOf(v)) ? v : INVALID;
            case "musicBlock": { String t = String.valueOf(v == JSONObject.NULL ? "" : v); return t.length() > 2000 ? t.substring(0, 2000) : t; }
            case "wallpaper": case "wallpaperName":
                return v == null || v == JSONObject.NULL ? JSONObject.NULL : String.valueOf(v);
            default: return INVALID;
        }
    }

    private static double toD(Object v) {
        try { return Double.parseDouble(String.valueOf(v)); } catch (Exception e) { return Double.NaN; }
    }
}
