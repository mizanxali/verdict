/** Voice controls: the dictation mic and its level meter, the stage badge, and the HUD toggle. */
import { useEffect, useRef, type RefObject } from "react";
import { IconMic, IconSpeaker } from "../art/Icons";
import type { Dictation } from "./useDictation";
import { voiceSettings, type VoiceSettings } from "./settings";

/** A few bars that follow the microphone level, updated on animation frames (no re-renders). */
export function LevelMeter({ level, bars = 5 }: { level: RefObject<number>; bars?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = ref.current;
      if (el) {
        const v = level.current ?? 0;
        el.querySelectorAll("i").forEach((bar, i) => {
          const wobble = 0.55 + 0.45 * Math.sin(performance.now() / 90 + i * 1.7);
          bar.style.transform = `scaleY(${Math.max(0.12, Math.min(1, v * 1.6 * wobble + 0.08))})`;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [level]);
  return (
    <span className="level-meter" ref={ref} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

/**
 * Hold to talk; or click once to start and again to stop (keyboard users press Enter/Space).
 * Hidden entirely when dictation is unavailable (no key on the server, unsupported browser).
 */
export function MicButton({ d, disabled }: { d: Dictation; disabled?: boolean }) {
  const pressedAt = useRef<number | null>(null);
  const viaPointer = useRef(false);
  if (!d.available) return null;
  const busy = d.phase === "transcribing" || d.phase === "starting";
  const live = d.phase === "recording" || d.phase === "starting";
  const label =
    d.phase === "recording" ? "Recording. Release to finish" : d.phase === "transcribing" ? "Transcribing" : "Hold to dictate (or hold Alt / Option)";
  return (
    <button
      type="button"
      className={`btn mic-btn${live ? " live" : ""}${d.phase === "transcribing" ? " working" : ""}`}
      disabled={disabled || d.phase === "transcribing"}
      aria-label={label}
      aria-pressed={live}
      aria-keyshortcuts="Alt"
      title="Hold to dictate. Or hold Alt / ⌥ Option anywhere. Click once to start, again to stop."
      onPointerDown={(e) => {
        if (e.button !== 0 || busy) return;
        viaPointer.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (d.phase === "recording") return; // second click of a click-to-toggle take: stop on up
        pressedAt.current = performance.now();
        void d.start();
      }}
      onPointerUp={() => {
        if (d.phase === "recording" || d.phase === "starting") {
          const held = pressedAt.current !== null ? performance.now() - pressedAt.current : 0;
          // A quick click starts a take that runs until the next click; a hold ends on release.
          if (pressedAt.current === null || held > 350) d.stop();
        }
        pressedAt.current = null;
      }}
      onPointerCancel={() => {
        pressedAt.current = null;
        d.stop();
      }}
      onClick={() => {
        if (viaPointer.current) {
          viaPointer.current = false;
          return;
        }
        // Keyboard activation: toggle.
        if (d.phase === "recording" || d.phase === "starting") d.stop();
        else if (d.phase === "idle") void d.start();
      }}
    >
      <IconMic />
      {live ? <LevelMeter level={d.level} /> : null}
    </button>
  );
}

/** One line under the input while dictation has something to say (otherwise nothing). */
export function DictationStatus({ d }: { d: Dictation }) {
  const n = d.notice;
  if (!n) return null;
  return (
    <span className={`dictation-status ${n.kind}`} role={n.kind === "error" ? "alert" : undefined} aria-live="polite">
      {n.kind === "recording" && <span className="rec-dot" aria-hidden />}
      {n.text}
    </span>
  );
}

/** Over the player's lawyer while recording: a microphone and the level. */
export function ListeningBadge({ x, y, level }: { x: number; y: number; level: RefObject<number> }) {
  return (
    <div className="listening-badge" style={{ left: x, top: y }} aria-hidden>
      <span className="rec-dot" />
      <IconMic />
      <LevelMeter level={level} bars={7} />
    </div>
  );
}

/** HUD: voice on/off (V), volume (in a popover on hover or focus), and a prompt when the
 *  browser is holding audio back until the page gets a click or key press. */
export function VoiceHudControls({ s }: { s: VoiceSettings }) {
  if (!s.tts) return null;
  return (
    <div className={`hud-voice${s.enabled ? " on" : ""}`}>
      <button
        type="button"
        className="icon-btn voice-btn"
        aria-pressed={s.enabled}
        aria-label="Voices"
        aria-keyshortcuts="V"
        title={s.enabled ? "Voices on. Press V to mute." : "Voices off. Press V to hear the court."}
        onClick={() => voiceSettings.setEnabled(!s.enabled)}
      >
        <IconSpeaker muted={!s.enabled} /> <kbd>V</kbd>
      </button>
      {s.enabled && (
        <div className="volume-pop">
          <label>
            <span>Volume</span>
            <input
              className="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.volume}
              onChange={(e) => voiceSettings.setVolume(Number(e.target.value))}
              style={{ ["--vol" as string]: `${Math.round(s.volume * 100)}%` }}
            />
          </label>
        </div>
      )}
      {s.enabled && s.locked && (
        <button type="button" className="sound-prompt" onClick={() => voiceSettings.setEnabled(true)}>
          <IconSpeaker /> Click to enable sound
        </button>
      )}
    </div>
  );
}
