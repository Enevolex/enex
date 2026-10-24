package com.enevolex.enex;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;

import com.enevolex.enex.net.Unblocker;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** İndirmeler Enex'in bağlantısı üzerinden yapılır (Discord'un sunucuları engelliyse de çalışsın). */
public final class Downloader {
    private final Context ctx;
    private final Unblocker unblocker;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    public Downloader(Context ctx, Unblocker unblocker) {
        this.ctx = ctx.getApplicationContext();
        this.unblocker = unblocker;
    }

    public void download(String url, String userAgent, String contentDisposition, String mime) {
        String name = URLUtil.guessFileName(url, contentDisposition, mime);
        io.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection(unblocker.javaProxy());
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                if (userAgent != null) c.setRequestProperty("User-Agent", userAgent);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) c.setRequestProperty("Cookie", cookie);
                String type = c.getContentType() != null ? c.getContentType().split(";")[0] : mime;
                try (InputStream in = c.getInputStream()) { save(name, type, in); }
                toast(I18n.t("download.done", Util.vars("name", name)));
            } catch (Exception e) {
                EnexLog.d("download", "başarısız: " + e.getClass().getSimpleName());
                toast(I18n.t("download.failed", Util.vars("name", name)));
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    /** Sayfadan gelen blob: verisi (base64). */
    public void saveBase64(String name, String mime, String b64) {
        io.execute(() -> {
            try {
                byte[] data = Base64.decode(b64, Base64.DEFAULT);
                save(name, mime, new java.io.ByteArrayInputStream(data));
                toast(I18n.t("download.done", Util.vars("name", name)));
            } catch (Exception e) {
                toast(I18n.t("download.failed", Util.vars("name", name)));
            }
        });
    }

    private void save(String name, String mime, InputStream in) throws Exception {
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = ctx.getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            if (mime != null) v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Enex");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IllegalStateException("MediaStore");
            try (OutputStream out = cr.openOutputStream(uri)) { copy(in, out); }
            v.clear();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, v, null, null);
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Enex");
            if (!dir.exists() && !dir.mkdirs()) dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            File f = new File(dir, name);
            try (OutputStream out = new FileOutputStream(f)) { copy(in, out); }
        }
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] b = new byte[32768];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
    }

    private void toast(String s) {
        main.post(() -> Toast.makeText(ctx, s, Toast.LENGTH_SHORT).show());
    }
}
