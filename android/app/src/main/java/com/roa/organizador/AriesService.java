package com.roa.organizador;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Escucha la palabra "Aries" en segundo plano (servicio en primer plano de tipo micrófono).
 * La detección es local con Vosk: el audio no sale de la tableta.
 */
public class AriesService extends Service implements RecognitionListener {
    static final String TAG = "Aries";
    static final String CH = "aries_escucha";
    static final String CH_WAKE = "aries_despertar";
    static final int NID = 4201;
    static final int NID_WAKE = 4202;
    static final int NID_BOOT = 4203;
    static final String ACTION_PAUSE = "com.roa.organizador.ARIES_PAUSE";
    static final String ACTION_RESUME = "com.roa.organizador.ARIES_RESUME";
    static final String ACTION_STOP = "com.roa.organizador.ARIES_STOP";
    static final String ACTION_CONFIG = "com.roa.organizador.ARIES_CONFIG";
    static final String MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip";
    static final String MODEL_DIR = "vosk-es-0.42";

    public interface Listener {
        void onWake();
        void onStatus(String state, int pct, String reason);
    }

    public static volatile AriesService instance;
    public static volatile Listener listener;
    static volatile String state = "off";
    static volatile int pct = 0;
    static volatile String reason = "";

    private final Handler main = new Handler(Looper.getMainLooper());
    private Model model;
    private SpeechService speech;
    private boolean userPaused = false;
    private boolean appHolds = false;
    private long lastWake = 0;
    private PowerManager.WakeLock cpuLock;
    private boolean loadingModel = false;

    private final Runnable tick = new Runnable() {
        @Override public void run() { evaluate(); main.postDelayed(this, 60000); }
    };
    private final Runnable releaseHold = () -> { appHolds = false; evaluate(); };
    private final BroadcastReceiver power = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { evaluate(); }
    };

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("aries", Context.MODE_PRIVATE); }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        createChannels(this);
        Notification n = buildNotification("Preparando Aries…", false);
        if (Build.VERSION.SDK_INT >= 29) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NID, n);
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_POWER_CONNECTED);
        f.addAction(Intent.ACTION_POWER_DISCONNECTED);
        registerReceiver(power, f);
        main.postDelayed(tick, 60000);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(a)) {
            prefs(this).edit().putBoolean("enabled", false).apply();
            stopRec();
            setStatus("off", 0, "");
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_PAUSE.equals(a)) userPaused = true;
        if (ACTION_RESUME.equals(a)) userPaused = false;
        ensureModel();
        evaluate();
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        try { unregisterReceiver(power); } catch (Exception ignored) {}
        stopRec();
        if (model != null) { model.close(); model = null; }
        instance = null;
        if (!"off".equals(state)) setStatus("off", 0, "");
        super.onDestroy();
    }

    // ---------- Pausa mientras la app usa el micrófono (dictado) ----------
    public static void hold(boolean on) {
        AriesService s = instance;
        if (s == null) return;
        s.main.post(() -> {
            s.appHolds = on;
            s.main.removeCallbacks(s.releaseHold);
            if (on) s.main.postDelayed(s.releaseHold, 120000); // por si la app no lo devuelve
            s.evaluate();
        });
    }

    // ---------- Modelo ----------
    private void ensureModel() {
        if (model != null || loadingModel) return;
        loadingModel = true;
        new Thread(() -> {
            try {
                File dir = new File(getFilesDir(), MODEL_DIR);
                if (!new File(dir, "ok").exists()) download(dir);
                setStatus("loading", 0, "");
                Model m = new Model(dir.getAbsolutePath());
                main.post(() -> { model = m; loadingModel = false; evaluate(); });
            } catch (Throwable e) {
                Log.e(TAG, "modelo", e);
                main.post(() -> { loadingModel = false; setStatus("error", 0, "No se pudo preparar el modelo de voz. Revisa la conexión a internet."); });
            }
        }).start();
    }

    private void download(File dir) throws Exception {
        setStatus("downloading", 0, "");
        File tmp = new File(getFilesDir(), MODEL_DIR + ".tmp");
        deleteTree(tmp);
        tmp.mkdirs();
        HttpURLConnection c = (HttpURLConnection) new URL(MODEL_URL).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        long total = c.getContentLengthLong();
        if (total <= 0) total = 39_000_000L;
        long got = 0;
        int lastPct = -1;
        try (InputStream raw = new BufferedInputStream(c.getInputStream());
             CountingStream in = new CountingStream(raw);
             ZipInputStream zip = new ZipInputStream(in)) {
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = zip.getNextEntry()) != null) {
                // Quita la carpeta raíz del zip (vosk-model-small-es-0.42/…)
                String name = e.getName();
                int slash = name.indexOf('/');
                String rel = slash >= 0 ? name.substring(slash + 1) : name;
                if (rel.isEmpty() || rel.contains("..")) continue;
                File out = new File(tmp, rel);
                if (e.isDirectory()) { out.mkdirs(); continue; }
                out.getParentFile().mkdirs();
                try (FileOutputStream fo = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buf)) > 0) {
                        fo.write(buf, 0, n);
                        int p = (int) Math.min(99, in.count * 100 / total);
                        if (p != lastPct) { lastPct = p; setStatus("downloading", p, ""); }
                    }
                }
            }
        } finally { c.disconnect(); }
        deleteTree(dir);
        if (!tmp.renameTo(dir)) throw new Exception("No se pudo guardar el modelo");
        new File(dir, "ok").createNewFile();
    }

    static class CountingStream extends java.io.FilterInputStream {
        long count = 0;
        CountingStream(InputStream in) { super(in); }
        @Override public int read() throws java.io.IOException { int b = super.read(); if (b >= 0) count++; return b; }
        @Override public int read(byte[] b, int off, int len) throws java.io.IOException { int n = super.read(b, off, len); if (n > 0) count += n; return n; }
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    // ---------- Cuándo escuchar ----------
    private boolean isCharging() {
        Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int plugged = b != null ? b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) : 0;
        return plugged != 0;
    }

    private static int minutes(String hhmm, int def) {
        try { String[] p = hhmm.split(":"); return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]); } catch (Exception e) { return def; }
    }

    /** null si puede escuchar; si no, el motivo */
    private String blockedReason() {
        if (userPaused) return "En pausa";
        SharedPreferences p = prefs(this);
        String mode = p.getString("mode", "siempre");
        if ("cargando".equals(mode) && !isCharging()) return "En pausa: no está cargando";
        if ("horario".equals(mode)) {
            Calendar c = Calendar.getInstance();
            int now = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
            int from = minutes(p.getString("from", "07:00"), 420), to = minutes(p.getString("to", "23:00"), 1380);
            boolean in = from <= to ? (now >= from && now < to) : (now >= from || now < to);
            if (!in) return "En pausa: fuera del horario (" + p.getString("from", "07:00") + "–" + p.getString("to", "23:00") + ")";
        }
        return null;
    }

    void evaluate() {
        if (model == null) { updateNotification(loadingModel ? "Preparando Aries…" : "Aries no está listo", false); return; }
        String why = blockedReason();
        if (appHolds) { stopRec(); setStatus("paused", 0, "La app está usando el micrófono"); updateNotification("Aries te está escuchando en la app", false); return; }
        if (why != null) { stopRec(); setStatus("paused", 0, why); updateNotification(why, true); return; }
        if (speech == null) startRec();
        if (speech != null) { setStatus("listening", 0, ""); updateNotification("Di “Aries” para hablarme", false); }
    }

    private void startRec() {
        try {
            Recognizer rec = new Recognizer(model, 16000.0f, "[\"aries\", \"[unk]\"]");
            rec.setWords(true);
            speech = new SpeechService(rec, 16000.0f);
            speech.startListening(this);
            if (cpuLock == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                cpuLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "organizador:aries");
            }
            if (!cpuLock.isHeld()) cpuLock.acquire();
        } catch (Throwable e) {
            Log.e(TAG, "micrófono", e);
            speech = null;
            setStatus("error", 0, "No se pudo usar el micrófono.");
        }
    }

    private void stopRec() {
        if (speech != null) {
            try { speech.stop(); } catch (Throwable ignored) {}
            try { speech.shutdown(); } catch (Throwable ignored) {}
            speech = null;
        }
        if (cpuLock != null && cpuLock.isHeld()) cpuLock.release();
    }

    // ---------- Resultados de Vosk ----------
    @Override public void onPartialResult(String hypothesis) {}
    @Override public void onResult(String hypothesis) { check(hypothesis); }
    @Override public void onFinalResult(String hypothesis) { check(hypothesis); }
    @Override public void onError(Exception e) { Log.e(TAG, "vosk", e); stopRec(); main.postDelayed(this::evaluate, 3000); }
    @Override public void onTimeout() {}

    private void check(String hyp) {
        try {
            JSONArray words = new JSONObject(hyp).optJSONArray("result");
            if (words == null) return;
            float sens = prefs(this).getFloat("sens", 0.8f);
            for (int i = 0; i < words.length(); i++) {
                JSONObject w = words.getJSONObject(i);
                if ("aries".equals(w.optString("word")) && w.optDouble("conf", 1) >= sens) { wake(); return; }
            }
        } catch (Exception ignored) {}
    }

    private void wake() {
        long now = System.currentTimeMillis();
        if (now - lastWake < 3000) return;
        lastWake = now;
        hold(true); // suelta el micrófono para el dictado
        boolean visible = MainActivity.visible;
        Listener l = listener;
        if (visible && l != null) { l.onWake(); return; }
        launchUi();
    }

    /** Prende la pantalla y abre la app en la carita */
    private void launchUi() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock screen = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE, "organizador:aries-pantalla");
            screen.acquire(10000);
        } catch (Throwable ignored) {}
        Intent i = new Intent(this, MainActivity.class)
            .setAction("com.roa.organizador.ARIES")
            .putExtra("aries", true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        // 1) Con el permiso "Mostrar sobre otras apps" se puede abrir directo
        if (Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this)) {
            try { startActivity(i); } catch (Throwable e) { Log.w(TAG, "abrir", e); }
        }
        // 2) Notificación de pantalla completa (con la pantalla apagada o bloqueada abre la app)
        PendingIntent pi = PendingIntent.getActivity(this, 7, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CH_WAKE)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Aries")
            .setContentText("Te escucho…")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(pi, true)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setTimeoutAfter(20000)
            .build();
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NID_WAKE, n);
    }

    // ---------- Estado y notificaciones ----------
    private void setStatus(String s, int p, String r) {
        state = s; pct = p; reason = r == null ? "" : r;
        Listener l = listener;
        if (l != null) main.post(() -> l.onStatus(state, pct, reason));
        if ("downloading".equals(s)) updateNotification("Descargando voz de Aries… " + p + "%", false);
    }

    static void createChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel a = new NotificationChannel(CH, "Aries escuchando", NotificationManager.IMPORTANCE_LOW);
        a.setDescription("Aviso fijo mientras Aries espera que digas su nombre");
        a.setShowBadge(false);
        nm.createNotificationChannel(a);
        NotificationChannel w = new NotificationChannel(CH_WAKE, "Aries: abrir al llamarlo", NotificationManager.IMPORTANCE_HIGH);
        w.setDescription("Abre la app cuando dices “Aries” con la pantalla apagada");
        w.setSound(null, null);
        nm.createNotificationChannel(w);
    }

    private Notification buildNotification(String text, boolean paused) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent po = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE);
        PendingIntent toggle = PendingIntent.getService(this, 2, new Intent(this, AriesService.class).setAction(userPaused ? ACTION_RESUME : ACTION_PAUSE), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 3, new Intent(this, AriesService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(userPaused ? "Aries en pausa" : "Aries")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(po)
            .addAction(0, userPaused ? "Reanudar" : "Pausar", toggle)
            .addAction(0, "Apagar", stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void updateNotification(String text, boolean paused) {
        try { ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NID, buildNotification(text, paused)); } catch (Throwable ignored) {}
    }
}
