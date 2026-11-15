/**
 * The presentation queue. The engine often emits several entries back to back (objection,
 * ruling, answer); this plays them one at a time, in record order, each held long enough to
 * read. It never changes game state: everything it shows comes from the trial view, the
 * settled entries and the live streams.
 *
 * Beats are identified by entry number. Everything up to `playedUpTo` has been seen; the
 * current beat is the first known entry after it, or, when the queue is empty, the last one
 * seen (it lingers on stage). A discarded stream simply vanishes from the known set, and a
 * retry under the same id restarts as a fresh beat (keyed by its start count).
 *
 * Voice: when a beat comes on stage live (not on the record at load, not part of a reconnect
 * catch-up) and its speaker is voiced, its audio drives it. The text types along with the
 * speech, the beat is done when the audio ends, auto-advance waits only a short breath, and
 * advancing early or losing the beat stops the audio at once. The next queued beat is
 * prefetched so it can start without a gap. Anything that goes wrong falls back to text timing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EntryKind, EventTag, FactCheck, Phase, RecordEntry, Speaker } from "../../src/shared/types";
import { entryNumber } from "./labels";
import type { TrialHandle } from "./useTrial";
import { clamp } from "./util";
import { speakerVoiceKey, type VoicePlayer } from "./voice/player";

export interface Beat {
  id: string;
  n: number;
  key: string;
  speaker: Speaker;
  kind: EntryKind;
  text: string;
  exhibitIds: string[];
  phase: Phase;
  ended: boolean;
  stricken: boolean;
  tags: EventTag[];
  factCheck?: FactCheck;
}

/** Characters revealed per second while a line types out. */
export const CPS = 62;

/** Backlog beyond which a reconnect or reload skips ahead instead of replaying. */
const MAX_BACKLOG = 5;

export interface Timing {
  /** Delay before the text starts (an objection shout, a ruling stamp). */
  lead: (b: Beat) => number;
  /** Extra time held after the text completes (a walk, a crack). */
  hold: (b: Beat) => number;
}

/** Pause after a voiced line ends before auto-advance moves on. */
export const BREATH_MS = 550;
/** Beats first seen this soon after the event stream (re)connects are catch-up: never voiced. */
const CATCH_UP_MS = 1500;

export interface VoiceOpts {
  player: VoicePlayer;
  /** Voice is wanted and possible right now (enabled, available, unlocked, not recording). */
  on: boolean;
}

/** Reveal clock. With `voiced`, the text follows the audio instead of the clock. */
export interface Reveal {
  key: string;
  start: number;
  skipped: boolean;
  acted: number;
  voiced: boolean;
  /** Characters to show at a time, while voiced. */
  charsAt?: (now: number) => number;
}

export function readingMs(b: Beat): number {
  const ms = clamp(1300 + b.text.length * 22, 1600, 8500);
  return b.speaker.kind === "player" ? ms * 0.4 : ms;
}

export function usePresenter(trial: TrialHandle, opts: { auto: boolean; timing: Timing; voice?: VoiceOpts }) {
  const { view, settled, streaming, starts, acted, syncedAt } = trial;
  const voice = opts.voice;

  const beats = useMemo<Beat[]>(() => {
    if (!view) return [];
    const byId = new Map<string, Beat>();
    const fromEntry = (e: RecordEntry): Beat => ({
      id: e.id,
      n: entryNumber(e.id),
      key: `${e.id}:${starts[e.id] ?? 0}`,
      speaker: e.speaker,
      kind: e.kind,
      text: e.text,
      exhibitIds: e.exhibitIds,
      phase: e.phase,
      ended: true,
      stricken: e.stricken,
      tags: e.tags,
      factCheck: e.factCheck,
    });
    for (const e of view.record) byId.set(e.id, fromEntry(e));
    for (const e of settled) if (!byId.has(e.id)) byId.set(e.id, fromEntry(e));
    for (const s of streaming) {
      if (byId.has(s.id)) continue;
      byId.set(s.id, {
        id: s.id,
        n: entryNumber(s.id),
        key: `${s.id}:${starts[s.id] ?? 0}`,
        speaker: s.speaker,
        kind: s.kind,
        text: s.text,
        exhibitIds: s.exhibitIds,
        phase: view.phase,
        ended: false,
        stricken: false,
        tags: [],
      });
    }
    return [...byId.values()].sort((a, b) => a.n - b.n);
  }, [view, settled, streaming, starts]);

  // When was each beat first seen? Catch-up after a (re)connect must not be spoken.
  const firstSeen = useRef(new Map<string, number>());
  const seenAt = performance.now();
  for (const b of beats) if (!firstSeen.current.has(b.key)) firstSeen.current.set(b.key, seenAt);
  const live = (b: Beat) => (firstSeen.current.get(b.key) ?? 0) - syncedAt > CATCH_UP_MS;
  const speakable = (b: Beat | undefined | null): b is Beat => !!b && !!voice?.on && !!view && live(b) && speakerVoiceKey(b.speaker) !== null;

  // Jump to the present on load: whatever is already in the record counts as seen.
  const [playedUpTo, setPlayedUpTo] = useState<number | null>(null);
  const initialKey = useRef<string | null>(null);
  useEffect(() => {
    if (playedUpTo !== null || !view) return;
    const last = view.record[view.record.length - 1];
    initialKey.current = last ? `${last.id}:${starts[last.id] ?? 0}` : null;
    setPlayedUpTo(last ? entryNumber(last.id) : 0);
  }, [view, playedUpTo, starts]);

  const base = playedUpTo ?? (view?.record.length ? entryNumber(view.record[view.record.length - 1]!.id) : 0);

  // After a reconnect the backlog can be long: skip to the last few.
  useEffect(() => {
    if (playedUpTo === null) return;
    const ahead = beats.filter((b) => b.n > playedUpTo && b.ended);
    if (ahead.length > MAX_BACKLOG) setPlayedUpTo(ahead[ahead.length - 3]!.n);
  }, [beats, playedUpTo]);

  const upcoming = beats.filter((b) => b.n > base);
  const current: Beat | null = upcoming[0] ?? [...beats].reverse().find((b) => b.n <= base) ?? null;
  const lingering = !upcoming[0];
  const queued = Math.max(0, upcoming.length - 1);

  // Reveal clock for the current beat.
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const curKey = current?.key ?? null;
  useEffect(() => {
    if (!current) return;
    if (reveal?.key === current.key) return;
    const instant = current.key === initialKey.current;
    const start = performance.now() + (instant ? 0 : opts.timing.lead(current));
    const voiced = !instant && speakable(current);
    const key = current.key;
    const player = voice?.player;
    setReveal({
      key,
      start,
      skipped: instant,
      acted,
      voiced,
      charsAt: voiced && player ? () => player.chars(key) : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  const r = reveal && current && reveal.key === current.key ? reveal : null;
  const [, setTick] = useState(0);
  const now = performance.now();
  const voiced = !!r && r.voiced && !r.skipped;
  const revealEnd = r ? r.start + (current!.text.length / CPS) * 1000 : Infinity;
  const done = !!current && current.ended && !!r && (r.skipped || (voiced ? voice!.player.finished(r.key) : now >= revealEnd));

  // ── voice: feed the line as it streams, arm it, prefetch the next, drop the rest ──
  const player = voice?.player;
  const trialId = view?.id ?? "";
  const next = upcoming[current && upcoming[0]?.key === current.key ? 1 : 0];
  const lineOf = (b: Beat) => ({ trialId, entryId: b.id, speaker: speakerVoiceKey(b.speaker)! });
  useEffect(() => {
    if (!player || !current || !voiced) return;
    player.feed(current.key, lineOf(current), current.text, current.ended);
    player.arm(current.key, r!.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, voiced, current?.key, current?.text, current?.ended]);
  const prefetch = speakable(next) ? next : null;
  useEffect(() => {
    if (!player || !prefetch) return;
    player.feed(prefetch.key, lineOf(prefetch), prefetch.text, prefetch.ended);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, prefetch?.key, prefetch?.text, prefetch?.ended]);
  // Keep the beat on stage (it may be a prefetch about to be armed) and the next one. A beat
  // that was skipped or switched to text has already been stopped explicitly.
  useEffect(() => {
    player?.retain([curKey, prefetch?.key]);
  }, [player, curKey, prefetch?.key]);
  // Re-render as the audio moves from sentence to sentence and when it ends.
  useEffect(() => player?.subscribe(() => setTick((x) => x + 1)), [player]);
  // Voice switched off (or the player started dictating) mid-line: carry on as text from here.
  useEffect(() => {
    if (voice?.on !== false || !r?.voiced || r.skipped) return;
    const shown = Math.min(voice.player.chars(r.key), current?.text.length ?? 0);
    voice.player.stop(r.key);
    setReveal({ ...r, voiced: false, charsAt: undefined, start: performance.now() - (shown / CPS) * 1000 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice?.on, r?.key, r?.voiced]);
  useEffect(() => () => player?.stopAll(), [player]);

  // Re-render when the reveal completes on its own.
  useEffect(() => {
    if (voiced) return;
    if (!current?.ended || !r || r.skipped) return;
    const ms = revealEnd - performance.now();
    if (ms <= 0) return;
    const t = setTimeout(() => setTick((x) => x + 1), ms + 16);
    return () => clearTimeout(t);
  }, [current?.ended, current?.text.length, r, revealEnd, voiced]);

  // When did this beat finish? Used for the auto-advance dwell.
  const doneAt = useRef<{ key: string; at: number } | null>(null);
  if (done && current && doneAt.current?.key !== current.key) doneAt.current = { key: current.key, at: now };

  const markPlayed = useCallback((n: number) => setPlayedUpTo((p) => (p === null || n > p ? n : p)), []);

  // Auto-advance: hold for reading time, quicker when a backlog builds up or the player has
  // already moved on (they acted while this beat was on stage).
  useEffect(() => {
    if (!done || !current || lingering) return;
    const playerMovedOn = r !== null && acted !== r.acted;
    if (!opts.auto && !playerMovedOn) return;
    // A voiced line has been heard in full: just a breath. Otherwise, time to read it.
    let ms = (voiced ? BREATH_MS : readingMs(current)) + opts.timing.hold(current);
    if (queued >= 4) ms *= 0.6;
    if (playerMovedOn && queued > 0) ms = Math.min(ms, 350);
    const since = performance.now() - (doneAt.current?.at ?? performance.now());
    const t = setTimeout(() => markPlayed(current.n), Math.max(0, ms - since));
    return () => clearTimeout(t);
  }, [done, current, lingering, opts.auto, opts.timing, queued, acted, r, markPlayed, voiced]);

  /** Click / Space / Enter: finish the line first, then move on. */
  const advance = useCallback(() => {
    if (!current || !r) return;
    if (!done) {
      // A voiced line stops talking at once and shows in full; the next press moves on.
      if (r.voiced) {
        player?.stop(r.key);
        setReveal({ ...r, skipped: true });
      } else if (performance.now() < r.start) setReveal({ ...r, start: performance.now() });
      else setReveal({ ...r, skipped: true });
      return;
    }
    if (!lingering) markPlayed(current.n);
  }, [current, r, done, lingering, markPlayed, player]);

  const presentedUpTo = current ? current.n : base;

  return {
    beats,
    beat: current,
    /** The beat that was already on the record when the page loaded: no effects replay. */
    isInitial: !!current && current.key === initialKey.current,
    reveal: r,
    done,
    /** This beat's audio is driving it. */
    voiced,
    /** Someone's mouth should be moving: audio is playing, or (unvoiced) text is typing. */
    speaking: !!current && !done && (voiced ? player!.speaking(current.key) : true),
    lingering,
    queued,
    /** Nothing left to show: the stage may hand control to the player. */
    drained: queued === 0 && (current === null || done),
    canContinue: done && !lingering && queued > 0,
    advance,
    presentedUpTo,
    phase: (current?.phase ?? view?.phase ?? "case_review") as Phase,
  };
}

export type Presenter = ReturnType<typeof usePresenter>;

/** Characters of a beat visible at time `now`. */
export function revealedChars(b: Beat, r: Pick<Reveal, "start" | "skipped" | "charsAt"> | null, now: number): number {
  if (!r) return 0;
  if (r.skipped) return b.text.length;
  if (r.charsAt) return clamp(r.charsAt(now), 0, b.text.length);
  return clamp(Math.floor(((now - r.start) / 1000) * CPS), 0, b.text.length);
}
