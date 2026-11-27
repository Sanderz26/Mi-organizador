package com.roa.organizador;

import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** ¿La app está en pantalla? (si sí, "Aries" se maneja dentro de la app) */
    public static volatile boolean visible = false;
    /** Se abrió por "Aries" antes de que la app web estuviera lista */
    public static volatile boolean launchedByAries = false;
    /** Alarma que abrió la app antes de que la app web estuviera lista */
    public static volatile String pendingAlarm = null;
    /** Carita chiquita con la app cerrada: la app arranca por detrás, sin mostrarse */
    public static volatile boolean pendingBubble = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AriesPlugin.class);
        registerPlugin(DevicePlugin.class);
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        if (in != null && in.getBooleanExtra("bubbleBoot", false)) {
            in.removeExtra("bubbleBoot");
            moveTaskToBack(true);
            overridePendingTransition(0, 0);
            return;
        }
        handleAries(in);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleAries(intent);
    }

    @Override public void onResume() { super.onResume(); visible = true; AriesService.appBack(); }
    @Override public void onPause() { visible = false; super.onPause(); }
    @Override public void onStop() { super.onStop(); AriesService.appLeft(); }

    private void handleAries(Intent i) {
        if (i == null) return;
        String alarm = i.getStringExtra("alarm");
        if (alarm != null) {
            i.removeExtra("alarm");
            showOverLock(true);
            pendingAlarm = alarm;
            AriesPlugin.fireAlarm(alarm, true);
            return;
        }
        if (!i.getBooleanExtra("aries", false)) return;
        i.removeExtra("aries");
        showOverLock(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(AriesService.NID_WAKE);
        launchedByAries = true;
        AriesPlugin.fireWake(true);
    }

    /** Mostrar la carita encima del bloqueo y mantener la pantalla prendida (solo mientras se habla con Aries) */
    public void showOverLock(boolean on) {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        } else {
            int f = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
            if (on) getWindow().addFlags(f); else getWindow().clearFlags(f);
        }
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
