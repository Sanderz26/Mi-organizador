package com.roa.organizador;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Recibe la hora de la alarma y los botones de la notificación (posponer / apagar) */
public class AlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        String id = i.getStringExtra("id");
        String a = i.getAction();
        if (id == null || a == null) return;
        switch (a) {
            case AlarmScheduler.ACTION_FIRE:
                AlarmScheduler.ring(c, id);
                AlarmScheduler.rescheduleAll(c); // la siguiente vez (si se repite); quita la pospuesta que ya sonó
                AriesPlugin.fireSnoozes();
                break;
            case AlarmScheduler.ACTION_SNOOZE:
                AlarmScheduler.snooze(c, id, 0);
                AriesPlugin.fireAlarmStopped(id);
                break;
            case AlarmScheduler.ACTION_UNSNOOZE:
                AlarmScheduler.unsnooze(c, id);
                break;
            case AlarmScheduler.ACTION_DISMISS:
                AlarmScheduler.stop(c, id);
                AriesPlugin.fireAlarmStopped(id);
                break;
        }
    }
}
