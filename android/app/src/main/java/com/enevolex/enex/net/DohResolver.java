package com.enevolex.enex.net;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Şifreli DNS (DNS-over-HTTPS, JSON biçimi). Sadece Enex'in bağlantıları için kullanılır.
 * Sunuculara IP adresiyle gidilir, böylece önce normal DNS'e sorulmaz.
 * Hiçbiri yanıt vermezse telefonun kendi DNS'ine düşer.
 * Android'e bağımlı değildir (masaüstü JDK'da test edilebilir).
 */
public final class DohResolver implements FrontProxy.Resolver {
    private static final String[] ENDPOINTS = {
            "https://1.1.1.1/dns-query?type=A&name=",
            "https://8.8.8.8/resolve?type=A&name=",
            "https://1.0.0.1/dns-query?type=A&name=",
            "https://8.8.4.4/resolve?type=A&name="
    };
    private static final Pattern OBJ = Pattern.compile("\\{[^{}]*\\}");
    private static final Pattern TYPE_A = Pattern.compile("\"type\"\\s*:\\s*1\\s*[,}]");
    private static final Pattern DATA = Pattern.compile("\"data\"\\s*:\\s*\"([0-9.]+)\"");
    private static final Pattern TTL = Pattern.compile("\"TTL\"\\s*:\\s*(\\d+)");

    private static final class Entry {
        final InetAddress[] addrs;
        final long until;
        Entry(InetAddress[] a, long u) { addrs = a; until = u; }
    }

    private final Map<String, Entry> cache = new ConcurrentHashMap<>();
    private volatile int preferred = 0;
    private volatile long dohBrokenUntil = 0;
    private volatile int failures = 0;
    private final boolean useDoh;

    public DohResolver(boolean useDoh) { this.useDoh = useDoh; }

    @Override
    public InetAddress[] resolve(String host) throws IOException {
        if (isIpLiteral(host)) return new InetAddress[]{InetAddress.getByName(host)};
        String key = host.toLowerCase();
        Entry e = cache.get(key);
        long now = System.currentTimeMillis();
        if (e != null && e.until > now) return e.addrs;

        if (useDoh && now > dohBrokenUntil) {
            for (int i = 0; i < ENDPOINTS.length; i++) {
                int idx = (preferred + i) % ENDPOINTS.length;
                try {
                    Entry r = query(ENDPOINTS[idx], key);
                    if (r != null) {
                        preferred = idx;
                        failures = 0;
                        cache.put(key, r);
                        return r.addrs;
                    }
                } catch (IOException ignored) {}
            }
            // Üst üste başarısızlık: DoH bir süre devre dışı (her istekte beklemeyelim)
            if (++failures >= 3) { dohBrokenUntil = now + 5 * 60_000L; failures = 0; }
        }
        InetAddress[] sys = InetAddress.getAllByName(host);
        cache.put(key, new Entry(sys, now + 60_000L));
        return sys;
    }

    private Entry query(String endpoint, String host) throws IOException {
        URL url = new URL(endpoint + URLEncoder.encode(host, "UTF-8"));
        HttpURLConnection c = (HttpURLConnection) url.openConnection(Proxy.NO_PROXY);
        c.setConnectTimeout(3500);
        c.setReadTimeout(3500);
        c.setRequestProperty("Accept", "application/dns-json");
        try {
            if (c.getResponseCode() != 200) return null;
            String body;
            try (InputStream in = c.getInputStream()) { body = readString(in); }
            return parse(body);
        } finally {
            c.disconnect();
        }
    }

    /** JSON yanıtından A kayıtlarını çıkarır (paket gerektirmeyen küçük ayrıştırıcı). */
    static Entry parse(String body) throws IOException {
        int ans = body.indexOf("\"Answer\"");
        if (ans < 0) return null;
        List<InetAddress> out = new ArrayList<>();
        long ttl = 300;
        Matcher m = OBJ.matcher(body.substring(ans));
        while (m.find()) {
            String o = m.group();
            if (!TYPE_A.matcher(o).find()) continue;
            Matcher d = DATA.matcher(o);
            if (!d.find()) continue;
            out.add(InetAddress.getByName(d.group(1)));
            Matcher t = TTL.matcher(o);
            if (t.find()) ttl = Math.min(ttl, Long.parseLong(t.group(1)));
        }
        if (out.isEmpty()) return null;
        ttl = Math.max(60, Math.min(ttl, 3600));
        return new Entry(out.toArray(new InetAddress[0]), System.currentTimeMillis() + ttl * 1000);
    }

    static List<String> parseForTest(String body) throws IOException {
        Entry e = parse(body);
        List<String> r = new ArrayList<>();
        if (e != null) for (InetAddress a : e.addrs) r.add(a.getHostAddress());
        return r;
    }

    static boolean isIpLiteral(String h) {
        return h.matches("^[0-9.]+$") || h.contains(":");
    }

    private static String readString(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) > 0) {
            out.write(b, 0, n);
            if (out.size() > 256 * 1024) break;
        }
        return out.toString("UTF-8");
    }
}
