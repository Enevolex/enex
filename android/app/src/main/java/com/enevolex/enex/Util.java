package com.enevolex.enex;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

public final class Util {
    private Util() {}

    public static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    public static Map<String, String> vars(String... kv) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    public static double clamp(double v, double lo, double hi) {
        if (Double.isNaN(v)) return lo;
        return Math.min(hi, Math.max(lo, v));
    }

    public static boolean isHex(String v) {
        return v != null && v.matches("^#[0-9a-fA-F]{6}$");
    }

    /** JavaScript string literal (JSON ile aynı kaçışlar). */
    public static String jsString(String s) {
        return org.json.JSONObject.quote(s == null ? "" : s);
    }
}
