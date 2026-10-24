package com.enevolex.enex.net;

import android.content.Context;

import com.enevolex.enex.EnexLog;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * ByeDPI (ciadpi): telefonda arka planda çalışan küçük yerel SOCKS proxy'si.
 * APK'nın içinde libciadpi.so adıyla durur (Android sadece native kütüphane klasöründeki
 * dosyaların çalıştırılmasına izin verir); third_party/byedpi kaynaklarından derlenir.
 */
public final class Ciadpi {
    public static final class MissingException extends IOException {
        MissingException() { super("ciadpi yok"); }
    }

    private final Process proc;
    private final int port;

    private Ciadpi(Process p, int port) {
        this.proc = p;
        this.port = port;
    }

    public int port() { return port; }

    public boolean alive() {
        try { proc.exitValue(); return false; } catch (IllegalThreadStateException e) { return true; }
    }

    public void stop() {
        try { proc.destroy(); } catch (Exception ignored) {}
    }

    public Process process() { return proc; }

    public static File binary(Context ctx) {
        return new File(ctx.getApplicationInfo().nativeLibraryDir, "libciadpi.so");
    }

    public static Ciadpi start(Context ctx, String[] args) throws IOException {
        File exe = binary(ctx);
        if (!exe.exists()) throw new MissingException();
        int port = freePort();
        List<String> cmd = new ArrayList<>();
        cmd.add(exe.getAbsolutePath());
        cmd.addAll(Arrays.asList("-i", "127.0.0.1", "-p", String.valueOf(port)));
        cmd.addAll(Arrays.asList(args));
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        Process p = pb.start();
        Thread reader = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String line;
                int n = 0;
                while ((line = r.readLine()) != null) {
                    if (n++ < 40) EnexLog.d("ciadpi", line);
                }
            } catch (IOException ignored) {}
        }, "ciadpi-log");
        reader.setDaemon(true);
        reader.start();

        long until = System.currentTimeMillis() + 4000;
        while (System.currentTimeMillis() < until) {
            try { int code = p.exitValue(); throw new IOException("ciadpi başlamadı (çıkış kodu " + code + ")"); }
            catch (IllegalThreadStateException running) { /* çalışıyor */ }
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress("127.0.0.1", port), 300);
                return new Ciadpi(p, port);
            } catch (IOException notYet) {
                try { Thread.sleep(100); } catch (InterruptedException ie) { break; }
            }
        }
        p.destroy();
        throw new IOException("ciadpi zamanında başlamadı");
    }

    private static int freePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0)) {
            s.setReuseAddress(true);
            return s.getLocalPort();
        }
    }
}
