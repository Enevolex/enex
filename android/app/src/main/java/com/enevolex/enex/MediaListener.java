package com.enevolex.enex;

import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;

/**
 * Sadece bir "kimlik": Android, çalan medya bilgisini (MediaSession) okumayı "Bildirim erişimi"
 * verilmiş uygulamalara açar. Enex bildirimlerin içeriğini OKUMAZ; bu servis hiçbir şey yapmaz.
 */
public final class MediaListener extends NotificationListenerService {
    public static ComponentName component(Context ctx) {
        return new ComponentName(ctx, MediaListener.class);
    }

    public static boolean granted(Context ctx) {
        String flat = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
        return flat != null && flat.contains(component(ctx).flattenToString());
    }
}
