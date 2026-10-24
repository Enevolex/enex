package com.enevolex.enex;

import android.content.Context;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Tanılama günlüğü: filesDir/enex-debug.log (masaüstündeki enex-debug.log'un karşılığı).
 * Hesap bilgisi, mesaj ya da token yazılmaz.
 */
public final class EnexLog {
    private static final long MAX = 512 * 1024;
    private static File file;
    private static final SimpleDateFormat FMT;
    static {
        FMT = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        FMT.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    private EnexLog() {}

    public static synchronized void init(Context ctx) {
        file = new File(ctx.getFilesDir(), "enex-debug.log");
        try {
            if (file.length() > MAX) {
                File old = new File(ctx.getFilesDir(), "enex-debug.log.old");
                old.delete();
                file.renameTo(old);
                file = new File(ctx.getFilesDir(), "enex-debug.log");
            }
        } catch (Exception ignored) {}
        write("\n===== Enex " + BuildConfig.VERSION_NAME + " · Android " + Build.VERSION.RELEASE
                + " (API " + Build.VERSION.SDK_INT + ") · " + Build.MANUFACTURER + " " + Build.MODEL + " =====\n");
    }

    public static File file() { return file; }

    public static void d(String scope, String msg) {
        Log.i("Enex", "[" + scope + "] " + msg);
        String line;
        synchronized (FMT) { line = FMT.format(new Date()); }
        write(line + " [" + scope + "] " + msg + "\n");
    }

    private static synchronized void write(String s) {
        if (file == null) return;
        try (FileWriter w = new FileWriter(file, true)) {
            w.write(s);
        } catch (Exception ignored) {}
    }
}
