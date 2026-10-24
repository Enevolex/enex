package com.enevolex.enex;

import android.Manifest;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * "Arka planda bağlı kal": Enex'in süreci kapatılmasın, Discord bağlantısı ve sesli sohbet
 * ekran kapalıyken de sürsün diye ön plan servisi. Mikrofon izni varsa mikrofon türüyle de
 * başlar (Android, arka plandaki uygulamaların mikrofonu kullanmasına ancak böyle izin verir).
 */
public final class KeepAliveService extends Service {
    public static final String ACTION_QUIT = "enex.quit";
    private static final int ID = 7;

    public static void start(Context ctx) {
        try {
            ctx.startForegroundService(new Intent(ctx, KeepAliveService.class));
        } catch (Exception e) {
            EnexLog.d("service", "başlatılamadı: " + e);
        }
    }

    public static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, KeepAliveService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_QUIT.equals(intent.getAction())) {
            // Bildirimdeki "Kapat": uygulamayı tamamen kapat
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            Intent quit = new Intent(this, MainActivity.class)
                    .setAction(ACTION_QUIT)
                    .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try { startActivity(quit); } catch (Exception ignored) {}
            return START_NOT_STICKY;
        }
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
                PendingIntent.FLAG_IMMUTABLE);
        PendingIntent quit = PendingIntent.getService(this, 1,
                new Intent(this, KeepAliveService.class).setAction(ACTION_QUIT), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, Notifier.CH_SERVICE)
                .setSmallIcon(R.drawable.ic_stat_enex)
                .setContentTitle(I18n.t("notif.service.title"))
                .setContentText(I18n.t("notif.service.text"))
                .setContentIntent(open)
                .setOngoing(true)
                .setColor(0xFF8B5CF6)
                .addAction(new Notification.Action.Builder(null, I18n.t("notif.service.stop"), quit).build())
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                }
                startForeground(ID, n, type);
            } else if (Build.VERSION.SDK_INT >= 30) {
                int type = 0;
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                }
                if (type == 0) startForeground(ID, n);
                else startForeground(ID, n, type);
            } else {
                startForeground(ID, n);
            }
        } catch (Exception e) {
            // Arka plandan başlatma kısıtlaması vb.: servis olmadan da çalışmaya devam
            EnexLog.d("service", "ön plana alınamadı: " + e);
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
