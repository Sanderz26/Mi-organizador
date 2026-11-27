package com.roa.organizador;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Abrir otras apps y buscar/leer documentos en carpetas que el usuario elige */
@CapacitorPlugin(name = "Dispositivo")
public class DevicePlugin extends Plugin {

    // ---------- Apps ----------
    @PluginMethod
    public void listApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> list = pm.queryIntentActivities(main, 0);
        JSArray arr = new JSArray();
        for (ResolveInfo r : list) {
            JSObject o = new JSObject();
            o.put("label", String.valueOf(r.loadLabel(pm)));
            o.put("pkg", r.activityInfo.packageName);
            arr.put(o);
        }
        JSObject res = new JSObject();
        res.put("apps", arr);
        call.resolve(res);
    }

    private void start(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        Intent i = getContext().getPackageManager().getLaunchIntentForPackage(call.getString("pkg", ""));
        if (i == null) { call.reject("No se pudo abrir esa app"); return; }
        try { start(i); call.resolve(); } catch (Throwable e) { call.reject("Android no dejó abrir la app"); }
    }

    /** Abre un enlace (YouTube, Spotify, Maps, web…), en una app concreta si se indica */
    @PluginMethod
    public void openUri(PluginCall call) {
        String uri = call.getString("uri", "");
        String pkg = call.getString("pkg", null);
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        if (pkg != null && !pkg.isEmpty()) {
            i.setPackage(pkg);
            try { start(i); call.resolve(); return; } catch (Throwable ignored) { i.setPackage(null); }
        }
        try { start(i); call.resolve(); } catch (Throwable e) { call.reject("No hay una app para abrir eso"); }
    }

    /** Deja un texto listo para enviar (WhatsApp u otra app); tú eliges el contacto y le das enviar */
    @PluginMethod
    public void shareText(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
        String pkg = call.getString("pkg", null);
        if (pkg != null) i.setPackage(pkg);
        try { start(i); call.resolve(); }
        catch (Throwable e) {
            try { start(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, call.getString("text", "")), "Enviar con")); call.resolve(); }
            catch (Throwable e2) { call.reject("No se pudo compartir"); }
        }
    }

    @PluginMethod
    public void dial(PluginCall call) {
        try { start(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + call.getString("number", "")))); call.resolve(); }
        catch (Throwable e) { call.reject("Esta tableta no puede hacer llamadas"); }
    }

    // ---------- Carpetas de documentos ----------
    private SharedPreferences prefs() { return getContext().getSharedPreferences("documentos", Context.MODE_PRIVATE); }
    private JSONArray folders() { try { return new JSONArray(prefs().getString("folders", "[]")); } catch (Exception e) { return new JSONArray(); } }

    @PluginMethod
    public void listFolders(PluginCall call) {
        JSObject r = new JSObject();
        try { r.put("folders", new JSArray(folders().toString())); } catch (Exception e) { r.put("folders", new JSArray()); }
        call.resolve(r);
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.reject("No elegiste ninguna carpeta"); return; }
        Uri tree = result.getData().getData();
        try { getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Throwable ignored) {}
        String name = tree.getLastPathSegment();
        if (name != null && name.contains(":")) name = name.substring(name.indexOf(':') + 1);
        if (name == null || name.isEmpty()) name = "Carpeta";
        try {
            JSONArray f = folders();
            for (int i = 0; i < f.length(); i++) if (tree.toString().equals(f.getJSONObject(i).optString("uri"))) { call.resolve(new JSObject(f.getJSONObject(i).toString())); return; }
            JSONObject o = new JSONObject().put("uri", tree.toString()).put("name", name);
            f.put(o);
            prefs().edit().putString("folders", f.toString()).apply();
            call.resolve(new JSObject(o.toString()));
        } catch (Exception e) { call.reject("No se pudo guardar la carpeta"); }
    }

    @PluginMethod
    public void removeFolder(PluginCall call) {
        String uri = call.getString("uri", "");
        JSONArray f = folders(), keep = new JSONArray();
        for (int i = 0; i < f.length(); i++) { JSONObject o = f.optJSONObject(i); if (o != null && !uri.equals(o.optString("uri"))) keep.put(o); }
        prefs().edit().putString("folders", keep.toString()).apply();
        try { getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Throwable ignored) {}
        call.resolve();
    }

    static String norm(String s) {
        String n = Normalizer.normalize(s == null ? "" : s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return n.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9ñ]+", " ").trim();
    }

    /** Busca archivos por nombre dentro de las carpetas elegidas */
    @PluginMethod
    public void search(PluginCall call) {
        String q = norm(call.getString("query", ""));
        int max = call.getInt("max", 20);
        String[] words = q.isEmpty() ? new String[0] : q.split(" ");
        getBridge().execute(() -> {
            ContentResolver cr = getContext().getContentResolver();
            List<JSObject> found = new ArrayList<>();
            JSONArray f = folders();
            String[] cols = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED };
            int visited = 0;
            for (int k = 0; k < f.length(); k++) {
                JSONObject fo = f.optJSONObject(k);
                if (fo == null) continue;
                Uri tree = Uri.parse(fo.optString("uri"));
                ArrayDeque<String[]> queue = new ArrayDeque<>();
                try { queue.add(new String[] { DocumentsContract.getTreeDocumentId(tree), "0" }); } catch (Throwable e) { continue; }
                while (!queue.isEmpty() && visited < 6000) {
                    String[] cur = queue.poll();
                    int depth = Integer.parseInt(cur[1]);
                    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, cur[0]);
                    try (Cursor c = cr.query(children, cols, null, null, null)) {
                        if (c == null) continue;
                        while (c.moveToNext()) {
                            visited++;
                            String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                            if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) { if (depth < 5) queue.add(new String[] { id, String.valueOf(depth + 1) }); continue; }
                            String n = norm(name);
                            boolean ok = true;
                            for (String w : words) if (!n.contains(w)) { ok = false; break; }
                            if (!ok) continue;
                            JSObject o = new JSObject();
                            o.put("name", name);
                            o.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                            o.put("mime", mime);
                            o.put("size", c.getLong(3));
                            o.put("modified", c.getLong(4));
                            o.put("folder", fo.optString("name"));
                            found.add(o);
                        }
                    } catch (Throwable ignored) {}
                }
            }
            found.sort((a, b) -> Long.compare(b.optLong("modified"), a.optLong("modified")));
            JSArray arr = new JSArray();
            for (int i = 0; i < Math.min(max, found.size()); i++) arr.put(found.get(i));
            JSObject r = new JSObject();
            r.put("files", arr);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uri = call.getString("uri", "");
        getBridge().execute(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri))) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] b = new byte[65536]; int n; long total = 0;
                while ((n = in.read(b)) > 0) { out.write(b, 0, n); total += n; if (total > 25L * 1024 * 1024) { call.reject("El archivo es muy grande para leerlo"); return; } }
                JSObject r = new JSObject();
                r.put("b64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                call.resolve(r);
            } catch (Throwable e) { call.reject("No se pudo leer el archivo"); }
        });
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(call.getString("uri", "")), call.getString("mime", "*/*"));
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { start(i); call.resolve(); } catch (Throwable e) { call.reject("No hay una app para abrir ese archivo"); }
    }
}
