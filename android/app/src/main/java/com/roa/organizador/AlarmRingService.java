package com.roa.organizador;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/**
 * Hace sonar la alarma con el tono, volumen y vibración elegidos, hasta que la apagas o pospones.
 * También sirve para escuchar un tono de prueba desde la app.
 */
public class AlarmRingService extends Service {
    static final String ACTION_RING = "com.roa.organizador.RING";
    static final String ACTION_PREVIEW = "com.roa.organizador.RING_PREVIEW";
    static final String ACTION_STOP = "com.roa.organizador.RING_STOP";
    static final String CH = "alarmas_sonando";
    static final int NID = 5900;

    static volatile String ringingId = null;
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Vibrator vib;
    private int savedVolume = -1;
    private float rampVol = 1f;

    @Override public IBinder onBind(Intent i) { return null; }

    static void ring(Context c, String id) {
        Intent i = new Intent(c, AlarmRingService.class).setAction(ACTION_RING).putExtra("id", id);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void preview(Context c, String alarmJson) {
        Intent i = new Intent(c, AlarmRingService.class).setAction(ACTION_PREVIEW).putExtra("alarm", alarmJson);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        c.startService(new Intent(c, AlarmRingService.class).setAction(ACTION_STOP));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(a) || a == null) { stopAll(); return START_NOT_STICKY; }
        JSONObject alarm;
        boolean preview = ACTION_PREVIEW.equals(a);
        String id;
        if (preview) {
            try { alarm = new JSONObject(intent.getStringExtra("alarm")); } catch (Exception e) { alarm = new JSONObject(); }
            id = "prueba";
        } else {
            id = intent.getStringExtra("id");
            alarm = AlarmScheduler.find(this, id);
            if (alarm == null) alarm = new JSONObject();
        }
        startForegroundNow(id, alarm, preview);
        ringingId = preview ? null : id;
        play(alarm, preview);
        // Se calla sola: la prueba a los 6 s, la alarma a los 10 min
        main.removeCallbacksAndMessages(null);
        main.postDelayed(this::stopAll, preview ? 6000 : 10 * 60000);
        return START_NOT_STICKY;
    }

    private void startForegroundNow(String id, JSONObject alarm, boolean preview) {
        createChannel(this);
        Notification n;
        if (preview) {
            n = new NotificationCompat.Builder(this, CH).setSmallIcon(R.drawable.ic_stat_notify).setContentTitle("Probando tono").setSilent(true).build();
        } else {
            String label = alarm.optString("label", "");
            int snoozeMin = alarm.optInt("snooze", 10);
            Intent open = new Intent(this, MainActivity.class).putExtra("alarm", id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            PendingIntent po = PendingIntent.getActivity(this, ("ring:" + id).hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent snooze = PendingIntent.getBroadcast(this, ("snooze:" + id).hashCode(), new Intent(this, AlarmReceiver.class).setAction(AlarmScheduler.ACTION_SNOOZE).putExtra("id", id), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent off = PendingIntent.getBroadcast(this, ("off:" + id).hashCode(), new Intent(this, AlarmReceiver.class).setAction(AlarmScheduler.ACTION_DISMISS).putExtra("id", id), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            n = new NotificationCompat.Builder(this, CH)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(label.isEmpty() ? "Alarma" : label)
                .setContentText("Son las " + alarm.optString("time", ""))
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(po, true)
                .setContentIntent(po)
                .setOngoing(true)
                .setSilent(true)
                .addAction(0, "Posponer " + snoozeMin + " min", snooze)
                .addAction(0, "Apagar", off)
                .build();
        }
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NID, n);
        if (!preview) showFullScreen(id);
    }

    /**
     * Pantalla apagada o bloqueada: prende la pantalla y abre la alarma en grande, aunque la app esté cerrada.
     * (No depende solo del permiso de "pantalla completa"; con "Mostrar sobre otras apps" se abre directo.)
     */
    private void showFullScreen(String id) {
        if (MainActivity.visible) return;
        android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        boolean inUse = pm.isInteractive() && (km == null || !km.isKeyguardLocked());
        if (inUse) return; // usando la tableta: basta el aviso flotante con Posponer/Apagar
        try {
            @SuppressWarnings("deprecation")
            android.os.PowerManager.WakeLock wl = pm.newWakeLock(android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK | android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP | android.os.PowerManager.ON_AFTER_RELEASE, "organizador:alarma-pantalla");
            wl.acquire(15000);
        } catch (Throwable ignored) {}
        if (Build.VERSION.SDK_INT < 23 || android.provider.Settings.canDrawOverlays(this)) {
            Intent open = new Intent(this, MainActivity.class).putExtra("alarm", id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            try { startActivity(open); } catch (Throwable ignored) {}
        }
    }

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CH) != null) return;
        NotificationChannel ch = new NotificationChannel(CH, "Alarma sonando", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Muestra la alarma en pantalla completa (el sonido lo pone la app)");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    /** Fuente del sonido según el tono elegido */
    private boolean setSource(MediaPlayer mp, JSONObject tone) throws Exception {
        String kind = tone != null ? tone.optString("kind", "default") : "default";
        switch (kind) {
            case "builtin": {
                String name = tone.optString("id", "suave").replaceAll("[^a-z]", "");
                File f = new File(getCacheDir(), "tono-" + name + ".wav");
                if (!f.exists()) {
                    try (InputStream in = getAssets().open("public/tonos/" + name + ".wav"); FileOutputStream out = new FileOutputStream(f)) {
                        byte[] b = new byte[16384]; int n;
                        while ((n = in.read(b)) > 0) out.write(b, 0, n);
                    }
                }
                mp.setDataSource(f.getAbsolutePath());
                return true;
            }
            case "file": {
                File f = new File(getFilesDir(), "adjuntos/" + tone.optString("fileId", ""));
                if (!f.exists()) return false; // aún no llegó por la sincronización
                mp.setDataSource(f.getAbsolutePath());
                return true;
            }
            case "android": {
                String u = tone.optString("uri", "");
                if (u.isEmpty()) return false;
                mp.setDataSource(this, Uri.parse(u));
                return true;
            }
            default: return false;
        }
    }

    private void play(JSONObject alarm, boolean preview) {
        stopSound();
        AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
        int vol = alarm.optInt("volume", 80);
        boolean ramp = !preview && alarm.optBoolean("ramp", true);
        // Volumen de alarma del sistema al nivel elegido (se devuelve al apagar)
        try {
            int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            if (savedVolume < 0) savedVolume = am.getStreamVolume(AudioManager.STREAM_ALARM);
            am.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(vol > 0 ? 1 : 0, Math.round(max * vol / 100f)), 0);
        } catch (Throwable ignored) {}
        player = new MediaPlayer();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        player.setLooping(true);
        try {
            if (!setSource(player, alarm.optJSONObject("tone"))) {
                Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                player.setDataSource(this, u);
            }
            player.prepare();
        } catch (Throwable e) {
            // Si el tono falla, el de Android
            try {
                player.reset();
                player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                player.setLooping(true);
                player.setDataSource(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
                player.prepare();
            } catch (Throwable ignored) { return; }
        }
        rampVol = ramp ? 0.12f : 1f;
        player.setVolume(rampVol, rampVol);
        player.start();
        if (ramp) main.post(new Runnable() {
            @Override public void run() {
                if (player == null || rampVol >= 1f) return;
                rampVol = Math.min(1f, rampVol + 0.03f); // ~30 s hasta el máximo
                try { player.setVolume(rampVol, rampVol); } catch (Throwable ignored) {}
                main.postDelayed(this, 1000);
            }
        });
        if (!preview && alarm.optBoolean("vibrate", true)) {
            vib = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            long[] pat = { 0, 700, 600 };
            try {
                if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createWaveform(pat, 0), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
                else vib.vibrate(pat, 0);
            } catch (Throwable ignored) {}
        }
    }

    private void stopSound() {
        if (player != null) { try { player.stop(); } catch (Throwable ignored) {} try { player.release(); } catch (Throwable ignored) {} player = null; }
        if (vib != null) { try { vib.cancel(); } catch (Throwable ignored) {} vib = null; }
    }

    private void stopAll() {
        main.removeCallbacksAndMessages(null);
        stopSound();
        if (savedVolume >= 0) {
            try { ((AudioManager) getSystemService(AUDIO_SERVICE)).setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0); } catch (Throwable ignored) {}
            savedVolume = -1;
        }
        String id = ringingId;
        ringingId = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
        if (id != null) AriesPlugin.fireAlarmStopped(id);
    }

    @Override public void onDestroy() { stopSound(); super.onDestroy(); }
}
