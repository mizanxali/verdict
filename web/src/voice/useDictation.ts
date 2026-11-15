/**
 * Push-to-talk dictation. Records with MediaRecorder while the mic button (or the hold key) is
 * held, sends the clip to the server for Deepgram speech-to-text, and hands the transcript to
 * whichever text field registered itself. It never submits anything: the player reviews it.
 *
 * Hold-to-talk key: Alt / Option, held on its own. It types nothing, no game shortcut uses it,
 * and a combination (Alt+letter, as for accented characters on a Mac) cancels the take.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { voicePlayer } from "./player";
import { voiceSettings, useVoiceSettings } from "./settings";

export const MAX_TAKE_MS = 60_000;
const MIN_TAKE_MS = 450;
/** Alt must be held this long alone before recording starts (so Alt+key combos never record). */
const KEY_HOLD_MS = 220;
const ERROR_MS = 6000;

export type DictationPhase = "idle" | "starting" | "recording" | "transcribing";

export interface DictationTarget {
  insert: (text: string) => void;
}

const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];

export function dictationSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined"
  );
}

function pickMime(): string {
  for (const m of MIME_PREFERENCE) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

function micError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone blocked. Allow it for this site in your browser to dictate, or type instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found.";
  if (name === "NotReadableError") return "The microphone is busy in another app.";
  return "Could not start the microphone.";
}

export function useDictation(trialId: string, enabled: boolean) {
  const settings = useVoiceSettings();
  const supported = dictationSupported();
  const available = enabled && supported && settings.stt === true;

  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0); // bumps when a transcript lands, for a brief confirmation
  const level = useRef(0); // 0..1, read by level meters on animation frames
  const target = useRef<DictationTarget | null>(null);
  const take = useRef<{
    stream: MediaStream;
    rec: MediaRecorder | null;
    chunks: Blob[];
    startedAt: number;
    cancelled: boolean;
    stopRequested: boolean;
    ctx: AudioContext | null;
    raf: number;
    limit: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  /** A take whose microphone is still opening (permission prompt, device start-up). */
  const opening = useRef<{ stopRequested: boolean; cancelled: boolean } | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), ERROR_MS);
    return () => clearTimeout(t);
  }, [error]);
  const [justAdded, setJustAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    setJustAdded(true);
    const t = setTimeout(() => setJustAdded(false), 4500);
    return () => clearTimeout(t);
  }, [added]);

  const release = useCallback(() => {
    const t = take.current;
    if (!t) return;
    cancelAnimationFrame(t.raf);
    if (t.limit) clearTimeout(t.limit);
    for (const tr of t.stream.getTracks()) tr.stop();
    void t.ctx?.close().catch(() => undefined);
    level.current = 0;
    take.current = null;
  }, []);

  const upload = useCallback(
    async (blob: Blob, ms: number) => {
      setPhase("transcribing");
      try {
        const res = await fetch(`/api/trials/${encodeURIComponent(trialId)}/transcribe`, {
          method: "POST",
          body: blob,
          headers: { "Content-Type": blob.type || "audio/webm", "X-Recording-Ms": String(Math.round(ms)) },
        });
        if (res.status === 503) {
          voiceSettings.sttUnavailable();
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
        if (!res.ok) {
          setError(body.error ?? `Transcription failed (${res.status}).`);
          return;
        }
        const text = (body.transcript ?? "").trim();
        if (!text) {
          setError("No speech detected. Hold the button (or Alt) while you speak.");
          return;
        }
        target.current?.insert(text);
        setAdded((n) => n + 1);
      } catch {
        setError("Could not reach the transcription service. Try again, or type it.");
      } finally {
        setPhase("idle");
      }
    },
    [trialId],
  );

  const stop = useCallback(
    (cancel = false) => {
      const t = take.current;
      if (!t) {
        // Released while the microphone is still opening: end the take as soon as it opens.
        if (opening.current) {
          opening.current.stopRequested = true;
          opening.current.cancelled ||= cancel;
        }
        return;
      }
      t.cancelled ||= cancel;
      if (!t.rec) {
        t.stopRequested = true;
        return;
      }
      if (t.rec.state !== "inactive") t.rec.stop();
    },
    [],
  );

  const start = useCallback(async () => {
    if (!available || take.current || opening.current || phaseRef.current !== "idle") return;
    setError(null);
    voicePlayer.stopAll(); // never record the characters' voices
    setPhase("starting");
    const o = { stopRequested: false, cancelled: false };
    opening.current = o;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      opening.current = null;
      setPhase("idle");
      setError(micError(e));
      return;
    }
    opening.current = null;
    if (o.cancelled) {
      for (const tr of stream.getTracks()) tr.stop();
      setPhase("idle");
      return;
    }
    const t = { stream, rec: null as MediaRecorder | null, chunks: [] as Blob[], startedAt: 0, cancelled: false, stopRequested: o.stopRequested, ctx: null as AudioContext | null, raf: 0, limit: null as ReturnType<typeof setTimeout> | null };
    take.current = t;

    // Level meter.
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        level.current = Math.min(1, level.current * 0.6 + Math.min(1, rms * 4) * 0.4);
        t.raf = requestAnimationFrame(tick);
      };
      t.ctx = ctx;
      tick();
    } catch {
      /* the meter is decoration */
    }

    let rec: MediaRecorder;
    try {
      const mime = pickMime();
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      release();
      setPhase("idle");
      setError("This browser cannot record audio.");
      return;
    }
    t.rec = rec;
    rec.ondataavailable = (e) => e.data.size && t.chunks.push(e.data);
    rec.onstop = () => {
      const ms = performance.now() - t.startedAt;
      const type = rec.mimeType || t.chunks[0]?.type || "audio/webm";
      release();
      if (t.cancelled) {
        setPhase("idle");
        return;
      }
      if (ms < MIN_TAKE_MS) {
        setPhase("idle");
        setError("Too short. Keep holding while you speak, then let go.");
        return;
      }
      void upload(new Blob(t.chunks, { type: type.split(";")[0] }), ms);
    };
    rec.start();
    t.startedAt = performance.now();
    t.limit = setTimeout(() => stop(), MAX_TAKE_MS);
    setPhase("recording");
    if (t.stopRequested) stop();
  }, [available, release, stop, upload]);

  // Stop everything if the controls go away mid-take.
  useEffect(() => {
    if (available) return;
    stop(true);
  }, [available, stop]);
  useEffect(() => () => stop(true), [stop]);

  // ── hold Alt / Option to talk ──
  useEffect(() => {
    if (!available) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let byKey = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        if (e.repeat || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (document.querySelector(".modal-root")) return;
        e.preventDefault();
        clear();
        timer = setTimeout(() => {
          timer = null;
          byKey = true;
          void start();
        }, KEY_HOLD_MS);
        return;
      }
      // Any other key while Alt is held: it was a shortcut or a special character, not a take.
      if (timer) clear();
      if (byKey && e.altKey) {
        byKey = false;
        stop(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      e.preventDefault(); // keeps Windows from focusing the browser menu
      clear();
      if (byKey) {
        byKey = false;
        stop();
      }
    };
    const blur = () => {
      clear();
      if (byKey) {
        byKey = false;
        stop();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      clear();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [available, start, stop]);

  const setTarget = useCallback((t: DictationTarget | null) => {
    target.current = t;
  }, []);

  /** What to tell the player under the input, if anything. */
  const notice: { kind: "error" | "added" | DictationPhase; text: string } | null = !available
    ? null
    : error
      ? { kind: "error", text: error }
      : phase === "starting"
        ? { kind: phase, text: "Opening the microphone…" }
        : phase === "recording"
          ? { kind: phase, text: "Listening… let go to finish" }
          : phase === "transcribing"
            ? { kind: phase, text: "Transcribing…" }
            : justAdded
              ? { kind: "added", text: "Dictation added. Check it before you submit." }
              : null;

  return { available, phase, notice, level, start, stop, setTarget };
}

export type Dictation = ReturnType<typeof useDictation>;
