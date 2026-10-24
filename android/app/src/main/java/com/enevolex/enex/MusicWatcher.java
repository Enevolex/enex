package com.enevolex.enex;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * "Dinliyor" durumu: telefonda çalan medyayı okur, masaüstündeki gizlilik filtresinden geçirir,
 * Discord'a yerel etkinlik olarak verir (masaüstündeki updateMusic/musicVerdict'in karşılığı).
 */
public final class MusicWatcher implements MediaSessionManager.OnActiveSessionsChangedListener {
    public interface Sink { void send(JSONObject activityMessage); }

    // Müzik uygulamaları: her modda paylaşılır (yasak kelimeler hariç)
    static final Set<String> MUSIC_APPS = new HashSet<>(Arrays.asList(
            "com.spotify.music", "com.spotify.lite", "com.google.android.apps.youtube.music", "app.revanced.android.apps.youtube.music",
            "deezer.android.app", "com.apple.android.music", "com.soundcloud.android", "com.aspiro.tidal", "com.amazon.mp3",
            "ru.yandex.music", "com.turkcell.gncplay", "com.anghami", "com.maxmpz.audioplayer", "com.musixmatch.android.lyrify",
            "com.sec.android.app.music", "com.miui.player", "com.google.android.music", "com.shazam.android",
            "com.bandcamp.android", "com.qobuz.music", "in.krosbits.musicolet", "com.kodarkooperativet.blackplayerfree",
            "org.akanework.gramophone", "com.piyush.music", "code.name.monkey.retromusic", "com.oppo.music", "com.heytap.music",
            "com.huawei.music", "com.vivo.music", "com.zing.mp3", "com.audiomack", "com.jio.media.jiobeats"));
    // Yetişkin içerik: hangi kaynaktan gelirse gelsin ASLA paylaşılmaz (masaüstüyle aynı)
    static final String[] ADULT_HARD = {"porn", "porno", "pornhub", "xvideos", "xnxx", "xhamster", "redtube", "youporn", "brazzers",
            "onlyfans", "fansly", "chaturbate", "stripchat", "xxx", "nsfw", "hentai", "rule34", "r34", "sikiş", "sikis", "camgirl",
            "r18", "jav", "ifşa", "ifsa"};
    static final String[] ADULT_SOFT = {"erotic", "erotik", "erotica", "nude", "nudes", "naked", "sex", "sexy", "seks", "çıplak",
            "ciplak", "escort", "milf", "webcam show", "+18", "18+", "yetişkin", "adult", "lewd", "ecchi", "bdsm", "fetish"};
    static final Pattern MUSIC_HINT = Pattern.compile("official\\s*(music\\s*)?(video|audio|visuali[sz]er)|music\\s*video|\\blyrics?\\b|lyric\\s*video|\\(audio\\)|\\[audio\\]|\\bft\\.|\\bfeat\\.?\\s|\\bprod\\.|\\bremix\\b|\\bslowed\\b|\\breverb\\b|\\bsped\\s*up\\b|\\bacoustic\\b|\\bklip\\b|şarkı sözleri|\\bcover\\b|\\blive\\s+(at|from|session)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    private final Context ctx;
    private final com.enevolex.enex.Settings settings;
    private final Sink sink;
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaSessionManager msm;
    private final List<MediaController> controllers = new ArrayList<>();
    private final MediaController.Callback cb = new MediaController.Callback() {
        @Override public void onPlaybackStateChanged(PlaybackState state) { schedule(); }
        @Override public void onMetadataChanged(MediaMetadata metadata) { schedule(); }
        @Override public void onSessionDestroyed() { schedule(); }
    };
    private boolean started;
    private String lastKey = "";
    private String verdictNow;
    private String sharedName;

    public MusicWatcher(Context ctx, com.enevolex.enex.Settings settings, Sink sink) {
        this.ctx = ctx.getApplicationContext();
        this.settings = settings;
        this.sink = sink;
    }

    public String verdict() { return verdictNow; }
    public String sharedName() { return sharedName; }

    /** Ayarlar ya da izin değişince çağrılır. */
    public void refresh() {
        boolean want = settings.bool("activityMusic") && MediaListener.granted(ctx);
        if (want && !started) start();
        else if (!want && started) stop();
        update();
    }

    private void start() {
        try {
            msm = ctx.getSystemService(MediaSessionManager.class);
            msm.addOnActiveSessionsChangedListener(this, MediaListener.component(ctx), main);
            onActiveSessionsChanged(msm.getActiveSessions(MediaListener.component(ctx)));
            started = true;
            EnexLog.d("music", "çalan medya izleniyor");
        } catch (SecurityException e) {
            EnexLog.d("music", "bildirim erişimi yok");
        }
    }

    private void stop() {
        try { if (msm != null) msm.removeOnActiveSessionsChangedListener(this); } catch (Exception ignored) {}
        for (MediaController c : controllers) try { c.unregisterCallback(cb); } catch (Exception ignored) {}
        controllers.clear();
        started = false;
    }

    @Override
    public void onActiveSessionsChanged(List<MediaController> list) {
        for (MediaController c : controllers) try { c.unregisterCallback(cb); } catch (Exception ignored) {}
        controllers.clear();
        if (list != null) {
            for (MediaController c : list) {
                if (c.getPackageName().equals(ctx.getPackageName())) continue;
                c.registerCallback(cb, main);
                controllers.add(c);
            }
        }
        schedule();
    }

    private final Runnable updateRunnable = this::update;
    private void schedule() {
        main.removeCallbacks(updateRunnable);
        main.postDelayed(updateRunnable, 400);
    }

    private void update() {
        JSONObject activity = null;
        verdictNow = null;
        MediaController playing = null;
        for (MediaController c : controllers) {
            PlaybackState st = c.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) { playing = c; break; }
        }
        if (started && settings.bool("activityMusic") && playing != null && playing.getMetadata() != null) {
            MediaMetadata md = playing.getMetadata();
            String title = str(md, MediaMetadata.METADATA_KEY_TITLE);
            String artist = str(md, MediaMetadata.METADATA_KEY_ARTIST);
            if (artist.isEmpty()) artist = str(md, MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
            String album = str(md, MediaMetadata.METADATA_KEY_ALBUM);
            String pkg = playing.getPackageName();
            String player = appLabel(pkg);
            String kind = MUSIC_APPS.contains(pkg) ? "music" : "browser";
            if (!title.isEmpty()) {
                verdictNow = verdict(title, artist, album, player, kind);
                if ("ok".equals(verdictNow)) {
                    try {
                        PlaybackState st = playing.getPlaybackState();
                        long pos = st.getPosition();
                        if (st.getLastPositionUpdateTime() > 0) {
                            pos += (long) ((SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime()) * st.getPlaybackSpeed());
                        }
                        long start = System.currentTimeMillis() - Math.max(0, pos);
                        long dur = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
                        // Saniyeye yuvarla: her küçük kaymada yeniden gönderme
                        start = (start / 1000) * 1000;
                        activity = new JSONObject();
                        String name = !player.isEmpty() ? player : (!artist.isEmpty() ? artist : I18n.t("activity.musicName"));
                        activity.put("application_id", "0");
                        activity.put("name", name.length() > 128 ? name.substring(0, 128) : name);
                        activity.put("type", 2); // Dinliyor
                        activity.put("flags", 1);
                        activity.put("status_display_type", artist.isEmpty() ? 2 : 1);
                        activity.put("details", title);
                        if (!artist.isEmpty()) activity.put("state", artist);
                        JSONObject ts = new JSONObject();
                        ts.put("start", start);
                        if (dur > 0) ts.put("end", start + dur);
                        activity.put("timestamps", ts);
                    } catch (Exception ignored) { activity = null; }
                }
            }
        }
        String key = String.valueOf(activity);
        if (key.equals(lastKey)) return;
        lastKey = key;
        sharedName = activity != null ? activity.optString("details") : null;
        if (activity != null) EnexLog.d("music", "müzik paylaşılıyor");
        else if (verdictNow != null && !"ok".equals(verdictNow)) EnexLog.d("music", "medya paylaşılmadı (" + verdictNow + ")");
        try {
            JSONObject msg = new JSONObject();
            msg.put("t", "activity");
            msg.put("socketId", "music");
            msg.put("kind", "music");
            msg.put("skipIfNative", true);
            msg.put("activity", activity == null ? JSONObject.NULL : activity);
            sink.send(msg);
        } catch (Exception ignored) {}
    }

    /** 'ok' ya da paylaşılmama nedeni (masaüstündeki musicVerdict). */
    String verdict(String title, String artist, String album, String app, String kind) {
        String text = title + " " + artist + " " + album + " " + app;
        if (blockRegex(!"music".equals(kind)).matcher(text).find()) return "blocked";
        String src = settings.str("musicSources");
        if ("all".equals(src)) return "ok";
        if ("music".equals(kind)) return "ok";
        if ("music".equals(src)) return "not-music-app";
        if (!album.isEmpty()) return "ok";
        if (artist.toLowerCase(Locale.ROOT).endsWith(" - topic")) return "ok";
        if (MUSIC_HINT.matcher(title).find()) return "ok";
        return "not-music";
    }

    private Pattern blockRegex(boolean soft) {
        List<String> words = new ArrayList<>(Arrays.asList(ADULT_HARD));
        if (soft) words.addAll(Arrays.asList(ADULT_SOFT));
        String custom = settings.str("musicBlock");
        if (custom != null) {
            for (String w : custom.split("[,\\n]")) {
                String t = w.trim().toLowerCase(Locale.ROOT);
                if (t.length() >= 2) words.add(t);
            }
        }
        StringBuilder alt = new StringBuilder();
        for (String w : words) {
            if (alt.length() > 0) alt.append('|');
            alt.append(Pattern.quote(w));
        }
        return Pattern.compile("(^|[^\\p{L}\\p{N}])(" + alt + ")(?=$|[^\\p{L}\\p{N}])",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    }

    private static String str(MediaMetadata md, String key) {
        CharSequence s = md.getText(key);
        return s == null ? "" : s.toString().trim();
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = ctx.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
            return String.valueOf(pm.getApplicationLabel(ai));
        } catch (Exception e) {
            return "";
        }
    }
}
