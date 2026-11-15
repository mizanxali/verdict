/**
 * Plays characters' lines, one sentence-sized segment at a time, back to back.
 *
 * A "track" is one beat (keyed like the presenter's beat key). Text is fed in as it streams;
 * each newly complete segment within a small lookahead window is requested from the server,
 * which streams Deepgram's raw 16-bit PCM. Chunks are scheduled on one Web Audio timeline as
 * they arrive, so sound starts at the first byte and consecutive segments join with no gap and
 * no overlap. A track plays only once armed (its beat is on stage); a track fed but not armed
 * is a prefetch of the next beat's first sentence.
 *
 * Failure never blocks the stage: a segment that cannot be fetched, or has nothing speakable in
 * it, becomes a silent stretch timed like the text-only typewriter.
 */
import { cleanForSpeech, splitSpeech } from "../../../src/shared/speech";

/** Text-only typing speed, characters per second (matches the presenter's CPS). */
const TEXT_CPS = 62;
/** Rough speaking rate before a segment has fully arrived (measured: Aura 12-18 chars/s). */
const SPEECH_CPS = 14.5;
/** Give up on a segment whose audio has not started arriving this long after it was due. */
const STALL_MS = 8000;
/** Segments requested beyond the one being placed on the timeline, and the most audio queued
 *  ahead of the playhead before asking for more. Aura streams ~2x real time, so this keeps the
 *  next sentence ready without paying for much a skip would throw away. */
const LOOKAHEAD = 1;
const MAX_AHEAD_S = 10;
/** Schedule audio in pieces of at least this many seconds (fewer nodes; first piece sooner). */
const MIN_PIECE_S = 0.12;
const DEFAULT_RATE = 24000;
/** Headroom so the first piece is never scheduled in the past. */
const START_PAD_S = 0.05;

export interface LineRef {
  trialId: string;
  entryId: string;
  /** "judge" | "prosecutor" | "clerk" | "w:<id>": checked by the server against the record. */
  speaker: string;
}

interface Seg {
  start: number;
  end: number;
  raw: string;
  /** Nothing to hear: no speakable text, or the request failed before any audio arrived. */
  silent: boolean;
  requested: boolean;
  abort: AbortController | null;
  /** Decoded audio not yet placed on the timeline. */
  pending: Float32Array[];
  pendingSamples: number;
  rate: number;
  /** All audio has arrived (or the stream gave up). */
  received: boolean;
  receivedSamples: number;
  /** Timeline (AudioContext seconds): when this segment starts and, once known, ends. */
  t0: number | null;
  t1: number | null;
  sources: AudioBufferSourceNode[];
  estS: number;
  stallWatch: boolean;
}

interface Track {
  key: string;
  line: LineRef;
  segs: Seg[];
  final: boolean;
  armed: boolean;
  /** Index of the segment being placed on the timeline. */
  next: number;
  /** Timeline position where the next audio goes. */
  cursor: number | null;
  timers: Set<ReturnType<typeof setTimeout>>;
  stopped: boolean;
  /** Characters revealed so far: the reveal never runs backwards when an estimate grows. */
  shown: number;
}

const textS = (chars: number) => chars / TEXT_CPS;

const AudioCtor = (): typeof AudioContext | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

export class VoicePlayer {
  private tracks = new Map<string, Track>();
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private _volume = 0.85;
  /** Called when the server turns out to have no voice (503). */
  onUnavailable: (() => void) | null = null;

  // ───────────── state for React ─────────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }

  get volume() {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = this._volume;
  }

  /** Can audio play right now without a fresh gesture? */
  get unlocked(): boolean {
    if (!AudioCtor()) return false;
    if (this.ctx) return this.ctx.state === "running";
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    return ua ? ua.hasBeenActive : false;
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = AudioCtor();
    if (!AC) return null;
    try {
      this.ctx = new AC({ latencyHint: "interactive" });
    } catch {
      return null;
    }
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this._volume;
    this.gain.connect(this.ctx.destination);
    this.ctx.onstatechange = () => this.changed();
    return this.ctx;
  }

  /** Call from inside a user gesture (click, key): browsers only let audio start after one. */
  unlock() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    if (ctx.state !== "running") {
      void ctx.resume().then(
        () => this.changed(),
        () => undefined,
      );
      // iOS Safari also wants something played inside the gesture.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start();
    }
    this.changed();
  }

  // ───────────── tracks ─────────────

  /** Adds the text streamed so far. Complete segments are requested within the lookahead. */
  feed(key: string, line: LineRef, text: string, final: boolean) {
    let t = this.tracks.get(key);
    if (!t) {
      t = { key, line, segs: [], final: false, armed: false, next: 0, cursor: null, timers: new Set(), stopped: false, shown: 0 };
      this.tracks.set(key, t);
    }
    if (t.stopped || t.final) return;
    const segs = splitSpeech(text, final);
    for (let i = t.segs.length; i < segs.length; i++) {
      const s = segs[i]!;
      const spoken = cleanForSpeech(s.text);
      t.segs.push({
        start: s.start,
        end: s.end,
        raw: s.text,
        silent: !spoken,
        requested: false,
        abort: null,
        pending: [],
        pendingSamples: 0,
        rate: DEFAULT_RATE,
        received: !spoken,
        receivedSamples: 0,
        t0: null,
        t1: null,
        sources: [],
        estS: spoken ? spoken.length / SPEECH_CPS : Math.min(textS(s.end - s.start), 0.9),
        stallWatch: false,
      });
    }
    if (final) {
      t.final = true;
      const last = t.segs.at(-1);
      if (last) last.end = text.length; // the last segment runs to the end of the text
    }
    this.fill(t);
    this.place(t);
  }

  /** The beat is on stage: play from `notBefore` (a performance.now() time). */
  arm(key: string, notBefore: number) {
    const t = this.tracks.get(key);
    const ctx = this.ensureCtx();
    if (!t || t.stopped || t.armed || !ctx) return;
    t.armed = true;
    t.cursor = ctx.currentTime + START_PAD_S + Math.max(0, notBefore - performance.now()) / 1000;
    this.fill(t);
    this.place(t);
  }

  /** Stops a beat's audio at once and forgets it. */
  stop(key: string) {
    const t = this.tracks.get(key);
    if (!t) return;
    this.halt(t);
    this.tracks.delete(key);
    this.changed();
  }

  /** Stops and forgets every track except these (the beat on stage and the one after it). */
  retain(keys: (string | null | undefined)[]) {
    const keep = new Set(keys.filter(Boolean));
    let any = false;
    for (const [k, t] of this.tracks) {
      if (keep.has(k)) continue;
      this.halt(t);
      this.tracks.delete(k);
      any = true;
    }
    if (any) this.changed();
  }

  stopAll() {
    this.retain([]);
  }

  /** Characters of the line to show now, following the audio clock. */
  chars(key: string): number {
    const t = this.tracks.get(key);
    const ctx = this.ctx;
    if (!t || !ctx || !t.armed) return 0;
    const now = ctx.currentTime;
    let shown = 0;
    for (const s of t.segs) {
      if (s.t0 === null || now < s.t0) break;
      if (s.t1 !== null && now >= s.t1) {
        shown = s.end;
        continue;
      }
      const dur = s.t1 !== null ? s.t1 - s.t0 : Math.max(s.estS, s.receivedSamples / s.rate);
      const frac = Math.min(0.97, Math.max(0, (now - s.t0) / Math.max(dur, 0.01)));
      shown = s.start + Math.floor((s.end - s.start) * frac);
      break;
    }
    t.shown = Math.max(t.shown, shown);
    return t.shown;
  }

  /** All text has arrived and every segment has been heard. A track not fed yet is not
   *  finished: the presenter stops voicing a beat explicitly when it moves on. */
  finished(key: string): boolean {
    const t = this.tracks.get(key);
    if (!t || !this.ctx || !t.armed) return false;
    if (!t.final || t.next < t.segs.length) return false;
    return t.cursor === null || this.ctx.currentTime >= t.cursor;
  }

  /** Sound is coming out right now (for the speaking animation). */
  speaking(key: string): boolean {
    const t = this.tracks.get(key);
    const ctx = this.ctx;
    if (!t || !ctx) return false;
    const now = ctx.currentTime;
    return t.segs.some((s) => !s.silent && s.t0 !== null && now >= s.t0 && now < (s.t1 ?? t.cursor ?? 0));
  }

  // ───────────── network ─────────────

  private url(line: LineRef, raw: string) {
    const q = new URLSearchParams({ entry: line.entryId, speaker: line.speaker, text: raw });
    return `/api/trials/${encodeURIComponent(line.trialId)}/speech?${q}`;
  }

  /** Requests the segments inside the lookahead window; a prefetch loads only its first. */
  private fill(t: Track) {
    if (t.stopped) return;
    const queued = this.ctx && t.cursor !== null ? t.cursor - this.ctx.currentTime : 0;
    const last = !t.armed ? 0 : queued > MAX_AHEAD_S ? t.next : t.next + LOOKAHEAD;
    for (let i = t.next; i <= last && i < t.segs.length; i++) {
      const s = t.segs[i]!;
      if (!s.silent && !s.requested) void this.load(t, s);
    }
  }

  private async load(t: Track, s: Seg) {
    s.requested = true;
    s.abort = new AbortController();
    let carry: number | null = null;
    try {
      const res = await fetch(this.url(t.line, s.raw), { signal: s.abort.signal });
      if (res.status === 503) this.onUnavailable?.();
      if (!res.ok || res.status === 204 || !res.body) throw new Error(`speech ${res.status}`);
      s.rate = Number(/rate=(\d+)/.exec(res.headers.get("content-type") ?? "")?.[1]) || DEFAULT_RATE;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done || t.stopped) break;
        // 16-bit little-endian samples; a chunk may split one across its boundary.
        let bytes = value;
        if (carry !== null) {
          const joined = new Uint8Array(bytes.length + 1);
          joined[0] = carry;
          joined.set(bytes, 1);
          bytes = joined;
          carry = null;
        }
        if (bytes.length % 2) {
          carry = bytes[bytes.length - 1]!;
          bytes = bytes.subarray(0, bytes.length - 1);
        }
        const n = bytes.length / 2;
        if (!n) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        const f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = view.getInt16(i * 2, true) / 32768;
        s.pending.push(f);
        s.pendingSamples += n;
        s.receivedSamples += n;
        this.place(t);
      }
    } catch {
      if (t.stopped) return;
      // Nothing arrived: carry on silently at reading speed. Something arrived: keep it.
      if (s.receivedSamples === 0) {
        s.silent = true;
        s.estS = textS(s.end - s.start);
      }
    } finally {
      s.abort = null;
    }
    if (t.stopped) return;
    s.received = true;
    this.place(t);
  }

  // ───────────── timeline ─────────────

  /** Puts whatever audio is ready onto the timeline, in segment order, gaplessly. */
  private place(t: Track) {
    const ctx = this.ctx;
    if (t.stopped || !t.armed || !ctx || !this.gain || t.cursor === null) return;
    // Never start in the past: after a stall, pick up from now.
    const at = () => Math.max(t.cursor!, ctx.currentTime + 0.02);
    let moved = false;
    while (t.next < t.segs.length) {
      const s = t.segs[t.next]!;
      if (s.silent) {
        s.t0 = at();
        s.t1 = s.t0 + s.estS;
        t.cursor = s.t1;
        this.advanceSeg(t, s);
        moved = true;
        continue;
      }
      const ready = s.pendingSamples / s.rate;
      if (s.t0 === null) {
        if (s.received && s.receivedSamples === 0) {
          s.silent = true; // arrived empty
          s.estS = textS(s.end - s.start);
          continue;
        }
        // Wait for a decent first piece, unless the whole segment is already here.
        if (ready < MIN_PIECE_S && !s.received) {
          this.watchStall(t, s);
          break;
        }
        s.t0 = at();
        t.cursor = s.t0;
        moved = true;
      }
      if (s.pendingSamples > 0 && (ready >= MIN_PIECE_S || s.received)) {
        this.schedule(t, s, ctx);
        moved = true;
      }
      if (s.received && s.pendingSamples === 0) {
        s.t1 = t.cursor;
        this.advanceSeg(t, s);
        moved = true;
        continue;
      }
      break;
    }
    if (moved) this.changed();
  }

  private advanceSeg(t: Track, s: Seg) {
    t.next++;
    this.mark(t, s.t1!);
    this.fill(t);
  }

  /** Moves a segment's pending audio onto the timeline at the cursor. */
  private schedule(t: Track, s: Seg, ctx: AudioContext) {
    const total = s.pendingSamples;
    const buf = ctx.createBuffer(1, total, s.rate);
    const ch = buf.getChannelData(0);
    let o = 0;
    for (const p of s.pending) {
      ch.set(p, o);
      o += p.length;
    }
    s.pending = [];
    s.pendingSamples = 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain!);
    // An underrun (audio arriving slower than it plays) leaves a short gap rather than a clash.
    const when = Math.max(t.cursor!, ctx.currentTime + 0.01);
    src.start(when);
    s.sources.push(src);
    t.cursor = when + total / s.rate;
  }

  /** Re-render when the timeline reaches `at` (a segment or the whole line ends). */
  private mark(t: Track, at: number) {
    const ms = Math.max(0, (at - this.ctx!.currentTime) * 1000) + 20;
    const timer = setTimeout(() => {
      t.timers.delete(timer);
      this.fill(t);
      this.changed();
    }, ms);
    t.timers.add(timer);
  }

  /** If a segment's audio never comes, give up on it and carry on silently. */
  private watchStall(t: Track, s: Seg) {
    if (s.stallWatch) return;
    s.stallWatch = true;
    const timer = setTimeout(() => {
      t.timers.delete(timer);
      if (t.stopped || s.t0 !== null) return;
      s.abort?.abort();
      if (s.receivedSamples === 0) {
        s.silent = true;
        s.estS = textS(s.end - s.start);
      }
      s.received = true;
      this.place(t);
    }, STALL_MS);
    t.timers.add(timer);
  }

  private halt(t: Track) {
    t.stopped = true;
    for (const timer of t.timers) clearTimeout(timer);
    t.timers.clear();
    for (const s of t.segs) {
      s.abort?.abort();
      for (const src of s.sources) {
        try {
          src.stop();
        } catch {
          /* never started */
        }
        src.disconnect();
      }
      s.sources = [];
      s.pending = [];
    }
  }
}

/** One player per page. */
export const voicePlayer = new VoicePlayer();

/** Server voice keys for a speaker (the player is never voiced). */
export function speakerVoiceKey(s: { kind: string; witnessId?: string }): string | null {
  if (s.kind === "player") return null;
  return s.kind === "witness" ? `w:${s.witnessId}` : s.kind;
}
