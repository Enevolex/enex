package com.enevolex.enex.net;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * WebView'ın kullandığı küçük yerel HTTP proxy'si (sadece 127.0.0.1).
 *
 *  WebView --(HTTP CONNECT host:port)--> FrontProxy --(şifreli DNS ile IP)--> [ciadpi SOCKS5] --> Discord
 *
 * WebView'a doğrudan SOCKS verilseydi alan adlarını telefonun (engelli olabilen) DNS'iyle çözerdi.
 * CONNECT isteğinde alan adı bize gelir; biz şifreli DNS ile çözüp ciadpi'ye IP olarak veririz.
 * socksPort &lt; 0 ise ciadpi kullanılmaz: sadece şifreli DNS + doğrudan bağlantı ("dns" yöntemi).
 * Android'e bağımlı değildir (masaüstü JDK'da test edilebilir).
 */
public final class FrontProxy implements Closeable {
    public interface Resolver {
        InetAddress[] resolve(String host) throws IOException;
    }

    public interface Logger {
        void log(String msg);
    }

    private static final int MAX_HEADER = 64 * 1024;
    private final ServerSocket server;
    private final Resolver resolver;
    private final int socksPort;
    private final Logger logger;
    private final ExecutorService pool;
    private final AtomicInteger active = new AtomicInteger();
    private volatile boolean closed;

    public FrontProxy(Resolver resolver, int socksPort, Logger logger) throws IOException {
        this.resolver = resolver;
        this.socksPort = socksPort;
        this.logger = logger;
        this.server = new ServerSocket(0, 256, InetAddress.getByName("127.0.0.1"));
        this.pool = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "enex-proxy");
            t.setDaemon(true);
            return t;
        });
        Thread acceptor = new Thread(this::acceptLoop, "enex-proxy-accept");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    public int port() { return server.getLocalPort(); }
    public int socksPort() { return socksPort; }
    public int activeConnections() { return active.get(); }

    private void acceptLoop() {
        while (!closed) {
            try {
                Socket c = server.accept();
                pool.execute(() -> handle(c));
            } catch (IOException e) {
                if (!closed) log("accept: " + e.getMessage());
            }
        }
    }

    private void handle(Socket client) {
        active.incrementAndGet();
        Socket upstream = null;
        try {
            client.setTcpNoDelay(true);
            client.setSoTimeout(30_000);
            InputStream cin = new BufferedInputStream(client.getInputStream(), 16384);
            OutputStream cout = client.getOutputStream();
            byte[] head = readHeader(cin);
            if (head == null) return;
            String headStr = new String(head, StandardCharsets.ISO_8859_1);
            int eol = headStr.indexOf("\r\n");
            String[] first = headStr.substring(0, eol).split(" ");
            if (first.length < 3) { reply(cout, 400, "Bad Request"); return; }
            String method = first[0];

            if ("CONNECT".equalsIgnoreCase(method)) {
                HostPort hp = HostPort.parse(first[1], 443);
                try {
                    upstream = open(hp.host, hp.port);
                } catch (IOException e) {
                    log("bağlanılamadı " + hp.host + ":" + hp.port + " (" + e.getMessage() + ")");
                    reply(cout, 502, "Bad Gateway");
                    return;
                }
                cout.write("HTTP/1.1 200 Connection Established\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
                cout.flush();
                client.setSoTimeout(0);
                pipe(client, cin, upstream);
                upstream = null;
                return;
            }

            // Düz HTTP (nadiren): mutlak adresi yola çevir, bağlantıyı tek istekle sınırla
            URI uri;
            try { uri = new URI(first[1]); } catch (Exception e) { reply(cout, 400, "Bad Request"); return; }
            if (uri.getHost() == null || !"http".equalsIgnoreCase(uri.getScheme())) { reply(cout, 400, "Bad Request"); return; }
            int port = uri.getPort() > 0 ? uri.getPort() : 80;
            String path = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
            if (uri.getRawQuery() != null) path += "?" + uri.getRawQuery();
            StringBuilder sb = new StringBuilder();
            sb.append(method).append(' ').append(path).append(' ').append(first[2]).append("\r\n");
            for (String line : headStr.substring(eol + 2).split("\r\n")) {
                if (line.isEmpty()) continue;
                String lower = line.toLowerCase();
                if (lower.startsWith("proxy-connection:") || lower.startsWith("connection:") || lower.startsWith("keep-alive:")) continue;
                sb.append(line).append("\r\n");
            }
            sb.append("Connection: close\r\n\r\n");
            try {
                upstream = open(uri.getHost(), port);
            } catch (IOException e) {
                reply(cout, 502, "Bad Gateway");
                return;
            }
            upstream.getOutputStream().write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
            upstream.getOutputStream().flush();
            client.setSoTimeout(0);
            pipe(client, cin, upstream);
            upstream = null;
        } catch (IOException e) {
            // istemci erken kapattı vb.
        } finally {
            closeQuietly(upstream);
            active.decrementAndGet();
        }
    }

    /** Hedefe bağlan: şifreli DNS ile çöz, sonra doğrudan ya da ciadpi (SOCKS5) üzerinden. */
    Socket open(String host, int port) throws IOException {
        InetAddress[] addrs = resolver.resolve(host);
        IOException last = null;
        // IPv4 önce: ciadpi ve çoğu mobil ağ için en sorunsuzu
        for (int pass = 0; pass < 2; pass++) {
            for (InetAddress a : addrs) {
                if ((pass == 0) != (a instanceof Inet4Address)) continue;
                try {
                    return socksPort > 0 ? viaSocks(a, port) : direct(a, port);
                } catch (IOException e) {
                    last = e;
                }
            }
        }
        throw last != null ? last : new IOException("adres yok: " + host);
    }

    private static Socket direct(InetAddress a, int port) throws IOException {
        Socket s = new Socket();
        try {
            s.setTcpNoDelay(true);
            s.connect(new InetSocketAddress(a, port), 10_000);
            return s;
        } catch (IOException e) {
            closeQuietly(s);
            throw e;
        }
    }

    private Socket viaSocks(InetAddress a, int port) throws IOException {
        Socket s = new Socket();
        try {
            s.setTcpNoDelay(true);
            s.connect(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), socksPort), 5_000);
            s.setSoTimeout(15_000);
            OutputStream o = s.getOutputStream();
            InputStream i = s.getInputStream();
            o.write(new byte[]{5, 1, 0});
            o.flush();
            byte[] r = readN(i, 2);
            if (r[0] != 5 || r[1] != 0) throw new IOException("socks: kimlik yöntemi reddedildi");
            byte[] ip = a.getAddress();
            ByteArrayOutputStream req = new ByteArrayOutputStream();
            req.write(new byte[]{5, 1, 0, (byte) (a instanceof Inet6Address ? 4 : 1)});
            req.write(ip);
            req.write((port >> 8) & 0xff);
            req.write(port & 0xff);
            o.write(req.toByteArray());
            o.flush();
            byte[] h = readN(i, 4);
            if (h[0] != 5) throw new IOException("socks: geçersiz yanıt");
            if (h[1] != 0) throw new IOException("socks: hata " + (h[1] & 0xff));
            int skip;
            switch (h[3]) {
                case 1: skip = 4; break;
                case 4: skip = 16; break;
                case 3: skip = readN(i, 1)[0] & 0xff; break;
                default: throw new IOException("socks: adres türü");
            }
            readN(i, skip + 2);
            s.setSoTimeout(0);
            return s;
        } catch (IOException e) {
            closeQuietly(s);
            throw e;
        }
    }

    /** İki yönlü aktarım. Bir yön bitince karşı tarafa yazma kapatılır; ikisi de bitince soketler kapanır. */
    private void pipe(Socket client, InputStream clientIn, Socket upstream) {
        AtomicInteger open = new AtomicInteger(2);
        Runnable done = () -> {
            if (open.decrementAndGet() == 0) {
                closeQuietly(client);
                closeQuietly(upstream);
            }
        };
        pool.execute(() -> {
            try {
                copy(upstream.getInputStream(), client.getOutputStream());
            } catch (IOException ignored) {
            } finally {
                try { client.shutdownOutput(); } catch (IOException ignored) {}
                done.run();
            }
        });
        try {
            copy(clientIn, upstream.getOutputStream());
        } catch (IOException ignored) {
        } finally {
            try { upstream.shutdownOutput(); } catch (IOException ignored) {}
            done.run();
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[32 * 1024];
        int n;
        while ((n = in.read(buf)) >= 0) {
            if (n == 0) continue;
            out.write(buf, 0, n);
            out.flush();
        }
    }

    private static byte[] readHeader(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream(512);
        int state = 0;
        while (b.size() < MAX_HEADER) {
            int c = in.read();
            if (c < 0) return null;
            b.write(c);
            if ((state == 0 || state == 2) && c == '\r') state++;
            else if ((state == 1 || state == 3) && c == '\n') state++;
            else state = c == '\r' ? 1 : 0;
            if (state == 4) return b.toByteArray();
        }
        return null;
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        byte[] b = new byte[n];
        int off = 0;
        while (off < n) {
            int r = in.read(b, off, n - off);
            if (r < 0) throw new IOException("bağlantı kapandı");
            off += r;
        }
        return b;
    }

    private static void reply(OutputStream out, int code, String text) {
        try {
            out.write(("HTTP/1.1 " + code + " " + text + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .getBytes(StandardCharsets.ISO_8859_1));
            out.flush();
        } catch (IOException ignored) {}
    }

    private void log(String m) {
        if (logger != null) logger.log(m);
    }

    static void closeQuietly(Closeable c) {
        if (c == null) return;
        try { c.close(); } catch (IOException ignored) {}
    }

    @Override
    public void close() {
        closed = true;
        closeQuietly(server);
        pool.shutdownNow();
    }

    static final class HostPort {
        final String host;
        final int port;
        HostPort(String h, int p) { host = h; port = p; }

        static HostPort parse(String s, int def) {
            if (s.startsWith("[")) {
                int end = s.indexOf(']');
                String h = s.substring(1, end);
                int p = def;
                if (end + 1 < s.length() && s.charAt(end + 1) == ':') p = Integer.parseInt(s.substring(end + 2));
                return new HostPort(h, p);
            }
            int c = s.lastIndexOf(':');
            if (c > 0 && s.indexOf(':') == c) return new HostPort(s.substring(0, c), Integer.parseInt(s.substring(c + 1)));
            return new HostPort(s, def);
        }
    }
}
