package com.enevolex.enex;

import android.content.Context;

import org.json.JSONObject;

import java.io.InputStream;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Dil dosyası: assets/i18n.json (masaüstündeki i18n.js'ten üretilir, mobil metinler eklenmiştir). */
public final class I18n {
    private static JSONObject all = new JSONObject();
    private static String lang = "tr";
    private static final Pattern VAR = Pattern.compile("\\{(\\w+)\\}");

    private I18n() {}

    public static void load(Context ctx) {
        try (InputStream in = ctx.getAssets().open("i18n.json")) {
            all = new JSONObject(new String(Util.readAll(in), "UTF-8"));
        } catch (Exception e) {
            EnexLog.d("i18n", "yüklenemedi: " + e);
        }
    }

    /** "auto" | "tr" | "en" */
    public static void setPref(String pref) {
        if ("tr".equals(pref) || "en".equals(pref)) lang = pref;
        else lang = Locale.getDefault().getLanguage().toLowerCase(Locale.ROOT).startsWith("tr") ? "tr" : "en";
    }

    public static String lang() { return lang; }

    public static String t(String key) { return t(key, null); }

    public static String t(String key, Map<String, String> vars) {
        String s = null;
        JSONObject cur = all.optJSONObject(lang);
        if (cur != null) s = cur.optString(key, null);
        if (s == null) {
            JSONObject en = all.optJSONObject("en");
            if (en != null) s = en.optString(key, null);
        }
        if (s == null) s = key;
        if (vars == null) return s;
        Matcher m = VAR.matcher(s);
        StringBuffer out = new StringBuffer();
        while (m.find()) {
            String v = vars.get(m.group(1));
            m.appendReplacement(out, Matcher.quoteReplacement(v != null ? v : m.group(0)));
        }
        m.appendTail(out);
        return out.toString();
    }

    /** Stüdyo için: İngilizce + seçili dil birleştirilmiş sözlük. */
    public static JSONObject dict() {
        JSONObject out = new JSONObject();
        try {
            for (String l : new String[]{"en", lang}) {
                JSONObject o = all.optJSONObject(l);
                if (o == null) continue;
                Iterator<String> it = o.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    out.put(k, o.get(k));
                }
            }
        } catch (Exception ignored) {}
        return out;
    }
}
