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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AriesPlugin.class);
        super.onCreate(savedInstanceState);
        handleAries(getIntent());
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
        if (i == null || !i.getBooleanExtra("aries", false)) return;
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
