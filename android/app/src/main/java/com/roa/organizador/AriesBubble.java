package com.roa.organizador;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Carita chiquita flotante en una esquina: Aries te escucha y te habla mientras usas otra app.
 * La conversación la maneja la app (JavaScript) por detrás; esta vista solo muestra el estado.
 */
public class AriesBubble {
    private static AriesBubble current;

    private final Context ctx;
    private final WindowManager wm;
    private final WindowManager.LayoutParams lp;
    private final LinearLayout root;
    private final TextView caption;
    private final FaceView face;

    static boolean canShow(Context c) { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(c); }
    static boolean showing() { return current != null; }

    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.getResources().getDisplayMetrics()); }

    @SuppressLint("ClickableViewAccessibility")
    private AriesBubble(Context c) {
        ctx = c.getApplicationContext();
        wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setGravity(Gravity.CENTER_VERTICAL);

        caption = new TextView(ctx);
        caption.setTextColor(Color.parseColor("#13232b"));
        caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        caption.setMaxWidth(dp(250));
        caption.setMaxLines(4);
        caption.setEllipsize(TextUtils.TruncateAt.END);
        caption.setPadding(dp(14), dp(10), dp(14), dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(1), Color.parseColor("#d9e4ea"));
        caption.setBackground(bg);
        caption.setElevation(dp(6));
        caption.setVisibility(View.GONE);
        LinearLayout.LayoutParams cl = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        cl.rightMargin = dp(8);
        root.addView(caption, cl);

        FrameLayout box = new FrameLayout(ctx);
        face = new FaceView(ctx);
        face.setElevation(dp(8));
        FrameLayout.LayoutParams fp = new FrameLayout.LayoutParams(dp(84), dp(84));
        fp.leftMargin = dp(10);
        fp.topMargin = dp(10);
        box.addView(face, fp);
        TextView close = new TextView(ctx);
        close.setText("×");
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        close.setTextColor(Color.WHITE);
        close.setGravity(Gravity.CENTER);
        close.setIncludeFontPadding(false);
        GradientDrawable cb = new GradientDrawable();
        cb.setShape(GradientDrawable.OVAL);
        cb.setColor(Color.parseColor("#cc13232b"));
        cb.setStroke(dp(2), Color.WHITE);
        close.setBackground(cb);
        close.setClickable(true);
        close.setContentDescription("Cerrar");
        FrameLayout.LayoutParams xl = new FrameLayout.LayoutParams(dp(32), dp(32));
        xl.gravity = Gravity.TOP | Gravity.START;
        box.addView(close, xl);
        close.setTranslationZ(dp(14)); // siempre encima de la cara (para que el toque le llegue)
        box.setPadding(dp(2), dp(2), dp(6), dp(6));
        box.setClipChildren(false);
        box.setClipToPadding(false);
        root.addView(box);

        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM | Gravity.END;
        lp.x = dp(16);
        lp.y = dp(96);

        close.setOnClickListener(v -> closeByUser());
        // Arrastrar con el dedo para moverla; tocar para abrir la app; mantener presionado para cerrarla
        face.setOnTouchListener(new View.OnTouchListener() {
            float sx, sy; int ox, oy; boolean moved, longDone;
            final Runnable longPress = () -> { longDone = true; face.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS); closeByUser(); };
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y; moved = false; longDone = false;
                        v.postDelayed(longPress, 700);
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = e.getRawX() - sx, dy = e.getRawY() - sy;
                        if (!moved && Math.abs(dx) + Math.abs(dy) > dp(10)) { moved = true; v.removeCallbacks(longPress); }
                        if (moved) {
                            // gravedad abajo-derecha: x y y se cuentan desde la esquina inferior derecha
                            lp.x = Math.max(0, ox - (int) dx);
                            lp.y = Math.max(0, oy - (int) dy);
                            try { wm.updateViewLayout(root, lp); } catch (Exception ignored) {}
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                        v.removeCallbacks(longPress);
                        if (!moved && !longDone) expand();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        v.removeCallbacks(longPress);
                        return true;
                }
                return false;
            }
        });
    }

    private void closeByUser() {
        hide();
        AriesPlugin.fireBubble("closed");
        // Si la app no está para cerrar la conversación, Aries vuelve a escuchar solo
        AriesService.hold(false);
    }

    /** Abre la app completa (con la conversación) */
    private void expand() {
        hide();
        AriesPlugin.fireBubble("expand");
        Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try { ctx.startActivity(i); } catch (Exception ignored) {}
    }

    static void show(Context c) {
        if (current != null || !canShow(c)) return;
        AriesBubble b = new AriesBubble(c);
        try { b.wm.addView(b.root, b.lp); current = b; b.face.setState("listening"); }
        catch (Exception e) { current = null; }
    }

    static void hide() {
        AriesBubble b = current;
        current = null;
        if (b == null) return;
        b.face.stop();
        try { b.wm.removeView(b.root); } catch (Exception ignored) {}
    }

    static void state(String state, String text) {
        AriesBubble b = current;
        if (b == null) return;
        b.face.setState(state);
        if (text != null) {
            b.caption.setText(text);
            b.caption.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE);
        }
    }

    static void level(float l) { AriesBubble b = current; if (b != null) b.face.level = Math.max(0, Math.min(1, l)); }

    /** La cara, dibujada igual que en la app */
    static class FaceView extends View {
        String state = "listening";
        float level = 0, ring = 0, look = 0, mouth = 0;
        long blinkAt = 0;
        boolean running = true;
        final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        final Paint ink = new Paint(Paint.ANTI_ALIAS_FLAG);
        final RectF r = new RectF();

        FaceView(Context c) {
            super(c);
            ink.setColor(Color.parseColor("#13475b"));
        }

        void setState(String s) { state = s; invalidate(); }
        void stop() { running = false; }

        @Override protected void onDraw(Canvas c) {
            float s = getWidth() / 200f;
            long t = System.currentTimeMillis();
            boolean listening = "listening".equals(state), thinking = "thinking".equals(state) || "transcribing".equals(state), speaking = "speaking".equals(state);
            float speakLvl = speaking ? (float) (0.15 + Math.abs(Math.sin(t / 1000.0 * 11)) * (0.55 + 0.45 * Math.sin(t / 1000.0 * 2.3)) * 0.75) : 0;
            mouth += (speakLvl - mouth) * 0.35f;
            ring += ((listening ? 0.25f + level * 0.9f : 0) - ring) * 0.2f;
            look += ((thinking ? 1 : 0) - look) * 0.08f;
            // Anillo de escucha
            if (ring > 0.01f) {
                p.setShader(null);
                p.setColor(Color.argb((int) (ring * 70), 31, 111, 139));
                r.set(0, 0, 200 * s, 200 * s);
                c.drawRoundRect(r, 64 * s, 64 * s, p);
            }
            // Cabeza
            float pad = 14 * s * (1 - ring * 0.25f);
            r.set(pad, pad, 200 * s - pad, 200 * s - pad);
            p.setShader(new LinearGradient(0, 0, 0, 200 * s, Color.parseColor("#e9f3f7"), Color.parseColor("#cfe4ec"), Shader.TileMode.CLAMP));
            c.drawRoundRect(r, 54 * s, 54 * s, p);
            p.setShader(null);
            // Ojos (con parpadeo)
            if (blinkAt == 0) blinkAt = t + 2500;
            if (t >= blinkAt + 150) blinkAt = t + 3000 + (long) (Math.random() * 2500);
            boolean blink = t >= blinkAt && t < blinkAt + 150;
            float eh = blink ? 4 : listening ? 38 : 34;
            for (float x : new float[] { 58, 122 }) {
                float ex = (x + look * 7) * s, ey = (87 - eh / 2 - look * 6) * s;
                r.set(ex, ey, ex + 20 * s, ey + eh * s);
                c.drawRoundRect(r, 10 * s, 10 * s, ink);
            }
            // Boca
            if (speaking) {
                float ry = (3 + mouth * 15) * s, rx = (15 + mouth * 5) * s;
                r.set(100 * s - rx, 136 * s - ry, 100 * s + rx, 136 * s + ry);
                c.drawOval(r, ink);
            } else {
                Paint st = new Paint(ink);
                st.setStyle(Paint.Style.STROKE);
                st.setStrokeWidth(5 * s);
                st.setStrokeCap(Paint.Cap.ROUND);
                Path path = new Path();
                path.moveTo(84 * s, 134 * s);
                path.quadTo(100 * s, 146 * s, 116 * s, 134 * s);
                c.drawPath(path, st);
            }
            // Pensando: puntitos
            if (thinking) {
                Paint d = new Paint(ink);
                d.setAlpha((int) (255 * (0.35 + 0.35 * Math.sin(t / 220.0))));
                c.drawCircle(150 * s, 44 * s, 4 * s, d);
                c.drawCircle(162 * s, 34 * s, 5 * s, d);
                c.drawCircle(176 * s, 22 * s, 6 * s, d);
            }
            if (running) postInvalidateOnAnimation();
        }
    }
}
