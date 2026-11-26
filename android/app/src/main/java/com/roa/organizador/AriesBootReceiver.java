package com.roa.organizador;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;

/**
 * Al reiniciar la tableta Android no deja prender el micrófono en segundo plano,
 * así que se muestra un aviso: con un toque se abre la app y Aries vuelve a escuchar.
 */
public class AriesBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        if (!AriesService.prefs(c).getBoolean("enabled", false)) return;
        AriesService.createChannels(c);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, 9, open, PendingIntent.FLAG_IMMUTABLE);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(AriesService.NID_BOOT, new NotificationCompat.Builder(c, AriesService.CH)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Aries está apagado")
            .setContentText("Toca aquí para que vuelva a escucharte")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build());
    }
}
