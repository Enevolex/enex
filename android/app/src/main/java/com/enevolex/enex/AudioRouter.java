package com.enevolex.enex;

import android.app.Activity;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import java.util.List;

/**
 * Sesli sohbette ses çıkışı. Discord'un web sürümü telefonda çıkış cihazı seçtiremez
 * ("masaüstü uygulamasını indirin" der); Enex bunu Android'in kendi yönlendirmesiyle yapar.
 *  auto    : kulaklık / Bluetooth takılıysa o, değilse hoparlör
 *  speaker : her zaman hoparlör
 *  earpiece: ahize (telefon görüşmesi gibi, kulağa tutarak)
 * Sohbet sürerken ses tuşları sohbet sesini ayarlar.
 */
public final class AudioRouter {
    public static final String[] MODES = {"auto", "speaker", "earpiece"};

    private final Activity act;
    private final AudioManager am;
    private boolean active;

    public AudioRouter(Activity act) {
        this.act = act;
        this.am = (AudioManager) act.getSystemService(Context.AUDIO_SERVICE);
    }

    public boolean active() { return active; }

    public void setVoice(boolean on, String mode) {
        if (on == active) { if (on) apply(mode); return; }
        active = on;
        try {
            if (on) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                act.setVolumeControlStream(AudioManager.STREAM_VOICE_CALL);
                apply(mode);
                EnexLog.d("audio", "sesli sohbet başladı · " + mode);
            } else {
                if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
                else am.setSpeakerphoneOn(false);
                am.setMode(AudioManager.MODE_NORMAL);
                act.setVolumeControlStream(AudioManager.USE_DEFAULT_STREAM_TYPE);
                EnexLog.d("audio", "sesli sohbet bitti");
            }
        } catch (Exception e) {
            EnexLog.d("audio", "yönlendirme hatası: " + e);
        }
    }

    @SuppressWarnings("deprecation")
    public void apply(String mode) {
        if (!active) return;
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                List<AudioDeviceInfo> devs = am.getAvailableCommunicationDevices();
                AudioDeviceInfo pick = null;
                if ("earpiece".equals(mode)) pick = find(devs, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
                else if ("speaker".equals(mode)) pick = find(devs, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER);
                else {
                    for (int t : new int[]{AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                            AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLE_HEADSET,
                            AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER}) {
                        pick = find(devs, t);
                        if (pick != null) break;
                    }
                }
                if (pick != null) am.setCommunicationDevice(pick);
            } else {
                boolean headset = am.isWiredHeadsetOn() || am.isBluetoothScoOn();
                boolean speaker = "speaker".equals(mode) || ("auto".equals(mode) && !headset);
                am.setSpeakerphoneOn(speaker);
            }
        } catch (Exception e) {
            EnexLog.d("audio", "çıkış ayarlanamadı: " + e);
        }
    }

    private static AudioDeviceInfo find(List<AudioDeviceInfo> devs, int type) {
        for (AudioDeviceInfo d : devs) if (d.getType() == type) return d;
        return null;
    }
}
