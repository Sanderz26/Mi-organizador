package com.roa.organizador;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Puente entre la app (JavaScript) y el servicio nativo de "Aries" */
@CapacitorPlugin(
    name = "Aries",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class AriesPlugin extends Plugin {
    static volatile AriesPlugin self;

    @Override public void load() {
        self = this;
        AriesService.listener = new AriesService.Listener() {
            @Override public void onWake() { fireWake(false); }
            @Override public void onStatus(String state, int pct, String reason) {
                JSObject o = new JSObject();
                o.put("state", state); o.put("pct", pct); o.put("reason", reason);
                notifyListeners("status", o);
            }
        };
        if (MainActivity.launchedByAries) fireWake(true);
    }

    /** launched: la app se abrió desde segundo plano por "Aries" */
    static void fireWake(boolean launched) {
        AriesPlugin p = self;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("launched", launched);
        o.put("locked", p.isLocked());
        p.notifyListeners("wake", o, true);
        if (launched) MainActivity.launchedByAries = false;
    }

    private boolean isLocked() {
        KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        return km != null && km.isKeyguardLocked();
    }

    private void savePrefs(PluginCall call) {
        SharedPreferences.Editor e = AriesService.prefs(getContext()).edit();
        if (call.hasOption("sens")) e.putFloat("sens", call.getFloat("sens", 0.8f));
        if (call.hasOption("mode")) e.putString("mode", call.getString("mode", "siempre"));
        if (call.hasOption("from")) e.putString("from", call.getString("from", "07:00"));
        if (call.hasOption("to")) e.putString("to", call.getString("to", "23:00"));
        e.apply();
    }

    @PluginMethod
    public void start(PluginCall call) {
        savePrefs(call);
        boolean mic = getPermissionState("microphone") == PermissionState.GRANTED;
        boolean notif = Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
        if (!mic || !notif) { requestPermissionForAliases(new String[] { "microphone", "notifications" }, call, "afterPerms"); return; }
        doStart(call);
    }

    @PermissionCallback
    private void afterPerms(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { call.reject("Sin permiso para usar el micrófono."); return; }
        doStart(call);
    }

    private void doStart(PluginCall call) {
        AriesService.prefs(getContext()).edit().putBoolean("enabled", true).apply();
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), AriesService.class).setAction(AriesService.ACTION_CONFIG));
            call.resolve(status());
        } catch (Throwable e) {
            call.reject("Android no dejó iniciar a Aries: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AriesService.prefs(getContext()).edit().putBoolean("enabled", false).apply();
        if (AriesService.instance != null) getContext().startService(new Intent(getContext(), AriesService.class).setAction(AriesService.ACTION_STOP));
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        savePrefs(call);
        if (AriesService.instance != null) getContext().startService(new Intent(getContext(), AriesService.class).setAction(AriesService.ACTION_CONFIG));
        call.resolve();
    }

    /** La app va a usar el micrófono (dictado): Aries lo suelta */
    @PluginMethod
    public void hold(PluginCall call) { AriesService.hold(true); call.resolve(); }

    /** La app terminó con el micrófono: Aries vuelve a escuchar */
    @PluginMethod
    public void release(PluginCall call) { AriesService.hold(false); call.resolve(); }

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("running", AriesService.instance != null);
        o.put("enabled", AriesService.prefs(getContext()).getBoolean("enabled", false));
        o.put("state", AriesService.state);
        o.put("pct", AriesService.pct);
        o.put("reason", AriesService.reason);
        return o;
    }

    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void permissions(PluginCall call) {
        Context c = getContext();
        JSObject o = new JSObject();
        o.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED);
        o.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        o.put("fullScreen", Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent());
        o.put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c));
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        o.put("battery", Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        call.resolve(o);
    }

    @PluginMethod
    public void openSetting(PluginCall call) {
        String which = call.getString("which", "");
        Context c = getContext();
        Uri pkg = Uri.parse("package:" + c.getPackageName());
        Intent i;
        switch (which) {
            case "fullScreen":
                i = Build.VERSION.SDK_INT >= 34 ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg) : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
                break;
            case "overlay":
                i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg);
                break;
            case "battery":
                i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg);
                break;
            case "notifications":
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName());
                break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
        }
        try { getActivity().startActivity(i); }
        catch (Throwable e) { getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)); }
        call.resolve();
    }

    @PluginMethod
    public void lockState(PluginCall call) { JSObject o = new JSObject(); o.put("locked", isLocked()); call.resolve(o); }

    /** Pide el PIN para salir de la pantalla de bloqueo */
    @PluginMethod
    public void unlock(PluginCall call) {
        Activity a = getActivity();
        KeyguardManager km = (KeyguardManager) a.getSystemService(Context.KEYGUARD_SERVICE);
        if (km == null || !km.isKeyguardLocked() || Build.VERSION.SDK_INT < 26) { JSObject o = new JSObject(); o.put("ok", !isLocked()); call.resolve(o); return; }
        a.runOnUiThread(() -> km.requestDismissKeyguard(a, new KeyguardManager.KeyguardDismissCallback() {
            @Override public void onDismissSucceeded() {
                if (a instanceof MainActivity) ((MainActivity) a).showOverLock(false);
                JSObject o = new JSObject(); o.put("ok", true); call.resolve(o);
            }
            @Override public void onDismissCancelled() { JSObject o = new JSObject(); o.put("ok", false); call.resolve(o); }
            @Override public void onDismissError() { JSObject o = new JSObject(); o.put("ok", false); call.resolve(o); }
        }));
    }

    /** Terminó la conversación: si se abrió sola, la app vuelve al fondo y la pantalla se apaga como siempre */
    @PluginMethod
    public void finish(PluginCall call) {
        boolean background = call.getBoolean("background", false);
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            if (a instanceof MainActivity) ((MainActivity) a).showOverLock(false);
            if (background) a.moveTaskToBack(true);
        });
        call.resolve();
    }
}
