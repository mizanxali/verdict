/**
 * Voice settings and availability, shared by the HUD, the stage and the dictation controls.
 * Remembered in localStorage. Availability comes from GET /api/voice, which is always 200, so a
 * server without a Deepgram key makes no noise in the console: voice simply never appears.
 */
import { useSyncExternalStore } from "react";
import { voicePlayer } from "./player";

const ENABLED_KEY = "trial-sim:voice";
const VOLUME_KEY = "trial-sim:volume";

export interface VoiceSettings {
  /** Server can speak / transcribe (has a Deepgram key). null until the probe answers. */
  tts: boolean | null;
  stt: boolean | null;
  /** The player wants characters voiced. */
  enabled: boolean;
  volume: number;
  /** Audio needs a click or key press before it may start (a reload mid-trial). */
  locked: boolean;
}

const readNumber = (k: string, d: number) => {
  const v = Number(localStorage.getItem(k));
  return localStorage.getItem(k) !== null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d;
};

let state: VoiceSettings = {
  tts: null,
  stt: null,
  enabled: localStorage.getItem(ENABLED_KEY) !== "0",
  volume: readNumber(VOLUME_KEY, 0.85),
  locked: !voicePlayer.unlocked,
};
voicePlayer.volume = state.volume;

const listeners = new Set<() => void>();
function set(patch: Partial<VoiceSettings>) {
  const next = { ...state, ...patch };
  if (Object.keys(patch).every((k) => next[k as keyof VoiceSettings] === state[k as keyof VoiceSettings])) return;
  state = next;
  for (const fn of listeners) fn();
}

voicePlayer.subscribe(() => set({ locked: !voicePlayer.unlocked }));
voicePlayer.onUnavailable = () => set({ tts: false });

let probed = false;
function probe() {
  if (probed) return;
  probed = true;
  fetch("/api/voice")
    .then((r) => (r.ok ? (r.json() as Promise<{ tts?: boolean; stt?: boolean }>) : { tts: false, stt: false }))
    .then((j) => set({ tts: !!j.tts, stt: !!j.stt }))
    .catch(() => set({ tts: false, stt: false }));
}

// Any gesture unlocks audio: the title screen's button normally, or the first click or key
// after a reload. Capture phase, so it runs even when a handler stops propagation.
const onGesture = () => {
  if (!voicePlayer.unlocked || state.locked) voicePlayer.unlock();
};
window.addEventListener("pointerdown", onGesture, true);
window.addEventListener("keydown", onGesture, true);

export const voiceSettings = {
  get: () => state,
  subscribe(fn: () => void) {
    probe();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setEnabled(on: boolean) {
    localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
    if (!on) voicePlayer.stopAll();
    else voicePlayer.unlock(); // toggling is itself a gesture
    set({ enabled: on });
  },
  setVolume(v: number) {
    const volume = Math.max(0, Math.min(1, v));
    localStorage.setItem(VOLUME_KEY, String(volume));
    voicePlayer.volume = volume;
    set({ volume });
  },
  /** Speech-to-text answered 503: hide the microphone. */
  sttUnavailable() {
    set({ stt: false });
  },
};

export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(voiceSettings.subscribe, voiceSettings.get);
}
