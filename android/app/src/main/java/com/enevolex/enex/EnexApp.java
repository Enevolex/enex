package com.enevolex.enex;

import android.app.Application;

import com.enevolex.enex.net.Unblocker;

public final class EnexApp extends Application {
    private Unblocker unblocker;

    @Override
    public void onCreate() {
        super.onCreate();
        EnexLog.init(this);
        I18n.load(this);
        Settings s = Settings.get(this);
        I18n.setPref(s.str("lang"));
        Notifier.createChannels(this);
        unblocker = new Unblocker(this, s);
    }

    /** Engel aşma uygulama boyunca tek: ekran yeniden kurulsa da bağlantı kopmaz. */
    public Unblocker unblocker() { return unblocker; }
}
