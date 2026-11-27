package com.roa.organizador;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/**
 * Alarmas de la app en la tableta. Usa AlarmManager.setAlarmClock (suenan aunque la app esté cerrada
 * y la tableta en reposo) y una notificación de alarma que repite el sonido hasta apagarla.
 */
public class AlarmScheduler {
    static final String CH = "alarmas_v1";
    static final String ACTION_FIRE = "com.roa.organizador.ALARM_FIRE";
    static final String ACTION_SNOOZE = "com.roa.organizador.ALARM_SNOOZE";
    static final String ACTION_DISMISS = "com.roa.organizador.ALARM_DISMISS";
    static final String ACTION_UNSNOOZE = "com.roa.organizador.ALARM_UNSNOOZE";
    static final String CH_SNOOZE = "alarmas_pospuestas";
    static final int NID_SNOOZE_BASE = 5400;
    static final int NID_BASE = 5000;

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("alarmas", Context.MODE_PRIVATE); }

    static JSONArray list(Context c) {
        try { return new JSONArray(prefs(c).getString("list", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static JSONObject find(Context c, String id) {
        JSONArray a = list(c);
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null && id.equals(o.optString("id"))) return o; }
        return null;
    }

    static JSONObject snoozes(Context c) {
        try { return new JSONObject(prefs(c).getString("snoozes", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    /** Guarda la lista que manda la app y vuelve a programar todo */
    static void save(Context c, String json) {
        prefs(c).edit().putString("list", json).apply();
        rescheduleAll(c);
    }

    static int nid(String id) { return NID_BASE + (id.hashCode() & 0x0fff); }

    private static PendingIntent firePi(Context c, String key, String id) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE).putExtra("id", id);
        return PendingIntent.getBroadcast(c, ("fire:" + key).hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void rescheduleAll(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences p = prefs(c);
        for (String key : p.getStringSet("scheduled", new HashSet<>())) {
            String id = key.endsWith("#s") ? key.substring(0, key.length() - 2) : key;
            am.cancel(firePi(c, key, id));
        }
        Set<String> now = new HashSet<>();
        long t0 = System.currentTimeMillis();
        JSONArray a = list(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || !o.optBoolean("enabled", true)) continue;
            long t = nextTime(o, t0);
            if (t <= 0) continue;
            String id = o.optString("id");
            schedule(c, am, id, id, t);
            now.add(id);
        }
        // Alarmas pospuestas
        JSONObject sn = snoozes(c);
        JSONObject keep = new JSONObject();
        Iterator<String> it = sn.keys();
        while (it.hasNext()) {
            String id = it.next();
            long t = sn.optLong(id, 0);
            if (t > t0) { schedule(c, am, id + "#s", id, t); now.add(id + "#s"); try { keep.put(id, t); } catch (Exception ignored) {} }
        }
        p.edit().putStringSet("scheduled", now).putString("snoozes", keep.toString()).apply();
    }

    private static void schedule(Context c, AlarmManager am, String key, String id, long t) {
        Intent show = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent ps = PendingIntent.getActivity(c, ("show:" + key).hashCode(), show, PendingIntent.FLAG_IMMUTABLE);
        try {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(t, ps), firePi(c, key, id));
        } catch (SecurityException e) {
            // Sin permiso de alarmas exactas: al menos una aproximada
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, firePi(c, key, id));
        }
    }

    /** Próxima vez que suena. days: 0 = domingo … 6 = sábado (como en JavaScript). date: AAAA-MM-DD para una sola vez. */
    static long nextTime(JSONObject a, long from) {
        String[] hm = a.optString("time", "06:00").split(":");
        int h, m;
        try { h = Integer.parseInt(hm[0]); m = Integer.parseInt(hm[1]); } catch (Exception e) { return 0; }
        JSONArray days = a.optJSONArray("days");
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(from);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.set(Calendar.HOUR_OF_DAY, h);
        c.set(Calendar.MINUTE, m);
        if (days == null || days.length() == 0) {
            String date = a.optString("date", "");
            if (date.length() == 10) {
                try {
                    c.set(Integer.parseInt(date.substring(0, 4)), Integer.parseInt(date.substring(5, 7)) - 1, Integer.parseInt(date.substring(8, 10)));
                } catch (Exception e) { return 0; }
                return c.getTimeInMillis() > from ? c.getTimeInMillis() : 0;
            }
            if (c.getTimeInMillis() <= from) c.add(Calendar.DAY_OF_MONTH, 1);
            return c.getTimeInMillis();
        }
        Set<Integer> set = new HashSet<>();
        for (int i = 0; i < days.length(); i++) set.add(days.optInt(i));
        for (int i = 0; i < 8; i++) {
            int js = c.get(Calendar.DAY_OF_WEEK) - 1;
            if (set.contains(js) && c.getTimeInMillis() > from) return c.getTimeInMillis();
            c.add(Calendar.DAY_OF_MONTH, 1);
        }
        return 0;
    }

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CH) != null) return;
        NotificationChannel ch = new NotificationChannel(CH, "Alarmas", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Alarmas que pones en la app (suenan hasta que las apagas)");
        Uri u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        ch.setSound(u, new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 700, 500, 700, 500, 700 });
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    /** Hace sonar la alarma (servicio con el tono, volumen y vibración elegidos) */
    static void ring(Context c, String id) {
        clearSnoozed(c, id);
        AlarmRingService.ring(c, id);
        // Si la app ya está en pantalla, se le avisa directo (si no, la abre la notificación de pantalla completa)
        if (MainActivity.visible) AriesPlugin.fireAlarm(id, false);
    }

    static void stop(Context c, String id) {
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(nid(id));
        AlarmRingService.stop(c);
    }

    static void snooze(Context c, String id, int min) {
        stop(c, id);
        JSONObject a = find(c, id);
        if (min <= 0) min = a != null ? a.optInt("snooze", 10) : 10;
        JSONObject sn = snoozes(c);
        try { sn.put(id, System.currentTimeMillis() + min * 60000L); } catch (Exception ignored) {}
        prefs(c).edit().putString("snoozes", sn.toString()).apply();
        rescheduleAll(c);
        showSnoozed(c, id, sn.optLong(id, 0));
        AriesPlugin.fireSnoozes();
    }

    /** Quita una alarma pospuesta (ya no vuelve a sonar) */
    static void unsnooze(Context c, String id) {
        JSONObject sn = snoozes(c);
        sn.remove(id);
        prefs(c).edit().putString("snoozes", sn.toString()).apply();
        rescheduleAll(c);
        clearSnoozed(c, id);
        AriesPlugin.fireSnoozes();
    }

    /** Aviso fijo "pospuesta hasta…" con botón para cancelarla */
    static void showSnoozed(Context c, String id, long t) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CH_SNOOZE) == null) {
                NotificationChannel ch = new NotificationChannel(CH_SNOOZE, "Alarmas pospuestas", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Muestra qué alarmas pospusiste y a qué hora vuelven a sonar");
                nm.createNotificationChannel(ch);
            }
        }
        JSONObject a = find(c, id);
        String label = a != null && !a.optString("label", "").isEmpty() ? a.optString("label") : "Alarma";
        java.text.DateFormat f = android.text.format.DateFormat.getTimeFormat(c);
        PendingIntent cancel = PendingIntent.getBroadcast(c, ("unsnooze:" + id).hashCode(), new Intent(c, AlarmReceiver.class).setAction(ACTION_UNSNOOZE).putExtra("id", id), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent po = PendingIntent.getActivity(c, 11, open, PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(c, CH_SNOOZE)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(label + " · pospuesta")
            .setContentText("Vuelve a sonar a las " + f.format(new java.util.Date(t)))
            .setWhen(t).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
            .setOngoing(true).setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(po)
            .addAction(0, "Cancelar", cancel)
            .setTimeoutAfter(Math.max(1000, t - System.currentTimeMillis()))
            .build();
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).notify(NID_SNOOZE_BASE + (id.hashCode() & 0x0fff), n);
    }

    static void clearSnoozed(Context c, String id) {
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NID_SNOOZE_BASE + (id.hashCode() & 0x0fff));
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        return ((AlarmManager) c.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
    }
}
