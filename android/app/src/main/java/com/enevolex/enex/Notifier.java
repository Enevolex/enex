package com.enevolex.enex;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Build;

import com.enevolex.enex.net.Unblocker;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Discord'un sayfa içi bildirimlerini telefon bildirimine çevirir. */
public final class Notifier {
    public static final String CH_MESSAGES = "messages";
    public static final String CH_SERVICE = "service";
    public static final String EXTRA_NOTIF = "enex.notif";

    private final Context ctx;
    private final Unblocker unblocker;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    public Notifier(Context ctx, Unblocker unblocker) {
        this.ctx = ctx.getApplicationContext();
        this.unblocker = unblocker;
    }

    public static void createChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel msg = new NotificationChannel(CH_MESSAGES, I18n.t("notif.channel.messages"), NotificationManager.IMPORTANCE_HIGH);
        msg.enableVibration(true);
        msg.setShowBadge(true);
        nm.createNotificationChannel(msg);
        NotificationChannel svc = new NotificationChannel(CH_SERVICE, I18n.t("notif.channel.service"), NotificationManager.IMPORTANCE_MIN);
        svc.setShowBadge(false);
        nm.createNotificationChannel(svc);
    }

    public static boolean allowed(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33
                && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        return nm != null && nm.areNotificationsEnabled();
    }

    public void show(int id, String title, String body, String icon, String tag) {
        io.execute(() -> {
            Bitmap large = icon != null && icon.startsWith("https://") ? fetchAvatar(icon) : null;
            Intent open = new Intent(ctx, MainActivity.class)
                    .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                    .putExtra(EXTRA_NOTIF, id);
            PendingIntent pi = PendingIntent.getActivity(ctx, id, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b = new Notification.Builder(ctx, CH_MESSAGES)
                    .setSmallIcon(R.drawable.ic_stat_enex)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .setCategory(Notification.CATEGORY_MESSAGE)
                    .setColor(0xFF8B5CF6)
                    .setGroup("enex-messages");
            if (large != null) b.setLargeIcon(large);
            try {
                NotificationManager nm = ctx.getSystemService(NotificationManager.class);
                int nid = tag != null && !tag.isEmpty() ? (tag.hashCode() & 0x3fffffff) | 0x40000000 : 0x10000 + id;
                nm.notify(nid, b.build());
            } catch (SecurityException e) {
                EnexLog.d("notify", "izin yok");
            }
        });
    }

    /** Avatar, Enex'in bağlantısı üzerinden (engelliyse de) indirilir; yuvarlak kırpılır. */
    private Bitmap fetchAvatar(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection(unblocker.javaProxy());
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            if (c.getResponseCode() != 200) return null;
            Bitmap src;
            try (InputStream in = c.getInputStream()) { src = BitmapFactory.decodeStream(in); }
            if (src == null) return null;
            int size = Math.min(src.getWidth(), src.getHeight());
            Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas cv = new Canvas(out);
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            cv.drawOval(new RectF(0, 0, size, size), p);
            p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
            cv.drawBitmap(src, new Rect(0, 0, size, size), new Rect(0, 0, size, size), p);
            return out;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
