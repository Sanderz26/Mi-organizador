package com.roa.organizador;

import android.content.Context;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;

/**
 * Escucha lo que dices mientras la carita chiquita está sobre otra app.
 * 1) Dictado de Android (rápido y gratis). 2) Si Android no lo permite, graba aquí y la app lo transcribe con Whisper.
 */
public class BubbleEars {
    public interface Done { void text(String t); void audio(String wavB64); void error(String msg); }

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static SpeechRecognizer sr;
    private static volatile boolean recStop = false;
    private static volatile boolean recording = false;

    static void listen(Context c, Done done) {
        main.post(() -> {
            cleanup();
            if (!SpeechRecognizer.isRecognitionAvailable(c)) { record(c, done); return; }
            try {
                sr = SpeechRecognizer.createSpeechRecognizer(c);
            } catch (Throwable e) { record(c, done); return; }
            final boolean[] finished = { false };
            sr.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { AriesBubble.state("listening", null); }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float db) { AriesBubble.level((db + 2f) / 12f); }
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() { AriesBubble.state("transcribing", null); }
                @Override public void onError(int e) {
                    if (finished[0]) return;
                    finished[0] = true;
                    cleanup();
                    if (e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) done.text("");
                    else record(c, done); // sin permiso, ocupado o desconectado: se graba aquí mismo
                }
                @Override public void onResults(Bundle b) {
                    if (finished[0]) return;
                    finished[0] = true;
                    ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    cleanup();
                    done.text(l != null && !l.isEmpty() ? l.get(0) : "");
                }
                @Override public void onPartialResults(Bundle b) {
                    ArrayList<String> l = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (l != null && !l.isEmpty() && !l.get(0).isEmpty()) AriesBubble.state("listening", "“" + l.get(0) + "”");
                }
                @Override public void onEvent(int t, Bundle b) {}
            });
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-CO")
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, c.getPackageName());
            try { sr.startListening(i); } catch (Throwable e) { finished[0] = true; cleanup(); record(c, done); }
        });
    }

    static void stop() {
        recStop = true;
        main.post(() -> { if (sr != null) { try { sr.stopListening(); } catch (Throwable ignored) {} } });
    }

    private static void cleanup() {
        if (sr != null) { try { sr.destroy(); } catch (Throwable ignored) {} sr = null; }
    }

    /** Graba con detección de silencio y devuelve un WAV (16 kHz, mono) */
    private static void record(Context c, Done done) {
        if (recording) { done.error("El micrófono está ocupado"); return; }
        recStop = false;
        new Thread(() -> {
            recording = true;
            final int rate = 16000;
            AudioRecord ar = null;
            try {
                int min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                ar = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, rate));
                if (ar.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("micrófono no disponible");
                ar.startRecording();
                ByteArrayOutputStream pcm = new ByteArrayOutputStream();
                short[] buf = new short[rate / 50]; // 20 ms
                long t0 = System.currentTimeMillis(), lastVoice = 0;
                double floor = 0; int calib = 0; boolean speech = false;
                while (!recStop) {
                    int n = ar.read(buf, 0, buf.length);
                    if (n <= 0) continue;
                    double sum = 0;
                    for (int k = 0; k < n; k++) sum += buf[k] * (double) buf[k];
                    double rms = Math.sqrt(sum / n);
                    long now = System.currentTimeMillis();
                    if (calib < 15) { floor += rms / 15; calib++; }
                    double thr = Math.max(500, floor * 3);
                    AriesBubble.level((float) Math.min(1, rms / 4000));
                    if (rms > thr) { speech = true; lastVoice = now; }
                    byte[] b = new byte[n * 2];
                    for (int k = 0; k < n; k++) { b[2 * k] = (byte) (buf[k] & 0xff); b[2 * k + 1] = (byte) ((buf[k] >> 8) & 0xff); }
                    pcm.write(b);
                    if (!speech && now - t0 > 7000) break;          // no dijo nada
                    if (speech && now - lastVoice > 1300) break;      // terminó de hablar
                    if (now - t0 > 20000) break;                      // tope
                }
                ar.stop();
                if (!speech) { main.post(() -> done.text("")); return; }
                byte[] wav = wav(pcm.toByteArray(), rate);
                String b64 = Base64.encodeToString(wav, Base64.NO_WRAP);
                main.post(() -> { AriesBubble.state("transcribing", null); done.audio(b64); });
            } catch (Throwable e) {
                main.post(() -> done.error("No se pudo usar el micrófono: " + e.getMessage()));
            } finally {
                if (ar != null) { try { ar.release(); } catch (Throwable ignored) {} }
                recording = false;
            }
        }).start();
    }

    private static byte[] wav(byte[] pcm, int rate) {
        int len = pcm.length;
        byte[] h = new byte[44];
        writeStr(h, 0, "RIFF"); writeInt(h, 4, 36 + len); writeStr(h, 8, "WAVE"); writeStr(h, 12, "fmt ");
        writeInt(h, 16, 16); writeShort(h, 20, 1); writeShort(h, 22, 1); writeInt(h, 24, rate); writeInt(h, 28, rate * 2);
        writeShort(h, 32, 2); writeShort(h, 34, 16); writeStr(h, 36, "data"); writeInt(h, 40, len);
        byte[] out = new byte[44 + len];
        System.arraycopy(h, 0, out, 0, 44);
        System.arraycopy(pcm, 0, out, 44, len);
        return out;
    }
    private static void writeStr(byte[] b, int o, String s) { for (int i = 0; i < s.length(); i++) b[o + i] = (byte) s.charAt(i); }
    private static void writeInt(byte[] b, int o, int v) { b[o] = (byte) v; b[o + 1] = (byte) (v >> 8); b[o + 2] = (byte) (v >> 16); b[o + 3] = (byte) (v >> 24); }
    private static void writeShort(byte[] b, int o, int v) { b[o] = (byte) v; b[o + 1] = (byte) (v >> 8); }
}
