/**
 * Live trials: one engine per trial, fanned out to any number of SSE subscribers, persisted to
 * data/trials/<id>.json after every settled action and after background scoring goes idle.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { InvalidActionError, type LoadCase, type TrialEngine } from "../shared/contracts";
import type { CaseFile, PlayerAction, PlayerView, RecordEntry, Speaker, TrialEvent, TrialState, VoiceUsage } from "../shared/types";
import { createTrial } from "../engine/index";
import { actionFits } from "./actions";
import { makeLlm, type LlmMode } from "./llmSelect";

type Subscriber = (event: TrialEvent) => void;
type Outcome = { ok: true } | { ok: false; error: unknown };
type EntryStart = Extract<TrialEvent, { type: "entry_start" }>;

interface Session {
  id: string;
  engine: TrialEngine;
  caseFile: CaseFile;
  /** Voice spend, counted here (never by the engine) and saved beside the engine state. */
  voice: VoiceUsage;
  subscribers: Set<Subscriber>;
  /** Streamed entries not yet ended, so a late subscriber can catch up mid-sentence. */
  inFlight: Map<string, { start: EntryStart; text: string }>;
  running: boolean;
  saveChain: Promise<void>;
  voiceSaveTimer: ReturnType<typeof setTimeout> | null;
}

/** On disk: the engine's state, plus the server's voice ledger under its own key. */
type SavedTrial = TrialState & { voiceUsage?: VoiceUsage };

export const emptyVoiceUsage = (): VoiceUsage => ({ ttsChars: 0, ttsRequests: 0, sttSeconds: 0, sttRequests: 0, costUsd: 0, seq: 0 });

const VOICE_SAVE_DELAY_MS = 2000;

export type SubmitResult =
  | { status: 202 }
  | { status: 409; message: string }
  | { status: 503; message: string };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const isTrialId = (id: string) => ID_RE.test(id);

const isInvalidAction = (e: unknown): e is Error =>
  e instanceof InvalidActionError || (e instanceof Error && e.name === "InvalidActionError");

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)) || "Unknown error.";

export class TrialHub {
  private sessions = new Map<string, Session>();
  private loading = new Map<string, Promise<Session | null>>();
  private readonly dir: string;
  private readonly loadCase: LoadCase;

  constructor(
    private readonly mode: LlmMode,
    opts: { loadCase: LoadCase; dataDir?: string },
  ) {
    this.loadCase = opts.loadCase;
    this.dir = opts.dataDir ?? path.resolve(process.cwd(), "data", "trials");
  }

  // ───────────── lifecycle ─────────────

  async create(): Promise<Session> {
    const id = `t${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
    const caseFile = this.loadCase();
    const session = this.build(id, caseFile, emptyVoiceUsage(), (emit) => createTrial({ caseFile, llm: makeLlm(this.mode), emit, id }));
    this.sessions.set(id, session);
    await this.save(session);
    return session;
  }

  /** In memory, or resumed from disk. null if unknown or unresumable. */
  async get(id: string): Promise<Session | null> {
    if (!isTrialId(id)) return null;
    const live = this.sessions.get(id);
    if (live) return live;
    let p = this.loading.get(id);
    if (!p) {
      p = this.resume(id).finally(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return p;
  }

  private async resume(id: string): Promise<Session | null> {
    let state: TrialState;
    let voice = emptyVoiceUsage();
    try {
      const saved = JSON.parse(await readFile(this.file(id), "utf8")) as SavedTrial;
      if (saved.voiceUsage) voice = { ...voice, ...saved.voiceUsage };
      delete saved.voiceUsage;
      state = saved;
    } catch {
      return null;
    }
    try {
      const caseFile = this.loadCase(state.caseId);
      const session = this.build(id, caseFile, voice, (emit) => createTrial({ caseFile, llm: makeLlm(this.mode), emit, state, id: state.id }));
      this.sessions.set(id, session);
      console.log(`[trials] resumed ${id} (phase ${state.phase})`);
      return session;
    } catch (e) {
      console.error(`[trials] could not resume ${id}: ${errorMessage(e)}`);
      return null;
    }
  }

  private build(id: string, caseFile: CaseFile, voice: VoiceUsage, make: (emit: (e: TrialEvent) => void) => TrialEngine): Session {
    // The engine needs emit before the session exists; bind lazily.
    let session: Session | undefined;
    const emit = (event: TrialEvent) => {
      if (session) this.dispatch(session, event);
    };
    const engine = make(emit);
    session = {
      id,
      engine,
      caseFile,
      voice,
      subscribers: new Set(),
      inFlight: new Map(),
      running: false,
      saveChain: Promise.resolve(),
      voiceSaveTimer: null,
    };
    return session;
  }

  // ───────────── views and voice ─────────────

  /** The engine's view, with the server's voice spend beside the model usage. */
  view(s: Session): PlayerView {
    return this.decorate(s, s.engine.view());
  }

  private decorate(s: Session, view: PlayerView): PlayerView {
    return s.voice.seq > 0 ? { ...view, voice: { ...s.voice } } : view;
  }

  /** A line on the record, or one still streaming: who says it and its text so far. */
  line(s: Session, entryId: string): { speaker: Speaker; text: string; ended: boolean } | null {
    const live = s.inFlight.get(entryId);
    if (live) return { speaker: live.start.speaker, text: live.text, ended: false };
    const e: RecordEntry | undefined = s.engine.state.record.find((r) => r.id === entryId);
    return e ? { speaker: e.speaker, text: e.text, ended: true } : null;
  }

  /** Adds billable voice usage. Saved shortly after (coalesced), broadcast with the next state. */
  recordVoice(s: Session, add: Partial<Omit<VoiceUsage, "seq">>): VoiceUsage {
    const v = s.voice;
    v.ttsChars += add.ttsChars ?? 0;
    v.ttsRequests += add.ttsRequests ?? 0;
    v.sttSeconds = Math.round((v.sttSeconds + (add.sttSeconds ?? 0)) * 1000) / 1000;
    v.sttRequests += add.sttRequests ?? 0;
    v.costUsd += add.costUsd ?? 0;
    v.seq += 1;
    // Coalesced: one save and one state broadcast (which carries the new figure to the cost
    // chip) per couple of seconds, however many sentences were voiced in between.
    if (!s.voiceSaveTimer) {
      s.voiceSaveTimer = setTimeout(() => {
        s.voiceSaveTimer = null;
        this.broadcastState(s);
        void this.save(s);
      }, VOICE_SAVE_DELAY_MS);
      s.voiceSaveTimer.unref?.();
    }
    return { ...v };
  }

  // ───────────── fan-out ─────────────

  private dispatch(s: Session, event: TrialEvent) {
    switch (event.type) {
      case "entry_start":
        s.inFlight.set(event.entryId, { start: event, text: "" });
        break;
      case "token": {
        const f = s.inFlight.get(event.entryId);
        if (f) f.text += event.text;
        break;
      }
      case "entry_end":
        s.inFlight.delete(event.entry.id);
        break;
      case "entry_discard":
        s.inFlight.delete(event.entryId);
        break;
    }
    if (event.type === "state") event = { ...event, view: this.decorate(s, event.view) };
    for (const sub of s.subscribers) {
      try {
        sub(event);
      } catch {
        /* a broken subscriber must not break the trial */
      }
    }
  }

  /** Sends the current state (and any half-streamed entries) first, then live events. */
  subscribe(s: Session, sub: Subscriber): () => void {
    sub({ type: "state", view: this.view(s) });
    for (const { start, text } of s.inFlight.values()) {
      sub(start);
      if (text) sub({ type: "token", entryId: start.entryId, text });
    }
    s.subscribers.add(sub);
    return () => s.subscribers.delete(sub);
  }

  private broadcastState(s: Session) {
    try {
      this.dispatch(s, { type: "state", view: s.engine.view() });
    } catch (e) {
      console.error(`[trials] view() failed for ${s.id}: ${errorMessage(e)}`);
    }
  }

  // ───────────── actions ─────────────

  async submit(s: Session, action: PlayerAction): Promise<SubmitResult> {
    if (s.running) return { status: 409, message: "The court is still dealing with your last move." };
    const pending = s.engine.state.pending;
    if (!actionFits(pending, action)) {
      const msg =
        pending === null
          ? "The court is working. Wait for your turn."
          : `The court is not waiting for "${action.type}" right now (it is waiting for "${pending}").`;
      return { status: 409, message: msg };
    }

    s.running = true;
    const box: { outcome: Outcome | null } = { outcome: null };
    const run = s.engine.act(action).then(
      () => void (box.outcome = { ok: true }),
      (error: unknown) => void (box.outcome = { ok: false, error }),
    );

    // Let the engine reject synchronous validation failures before answering 202.
    await new Promise<void>((r) => setImmediate(r));
    const early = box.outcome;
    if (early && !early.ok && isInvalidAction(early.error)) {
      s.running = false;
      return { status: 409, message: errorMessage(early.error) };
    }

    this.broadcastState(s);
    void run.then(() => this.settle(s, box.outcome));
    return { status: 202 };
  }

  private settle(s: Session, outcome: Outcome | null) {
    s.running = false;
    if (outcome && !outcome.ok) {
      const msg = errorMessage(outcome.error);
      console.error(`[trials] action failed in ${s.id}: ${msg}`);
      this.dispatch(s, { type: "error", message: isInvalidAction(outcome.error) ? msg : `The court hit a problem: ${msg}` });
    }
    this.broadcastState(s);
    void this.save(s);
    s.engine
      .idle()
      .then(() => {
        this.broadcastState(s);
        return this.save(s);
      })
      .catch((e) => console.error(`[trials] background scoring failed in ${s.id}: ${errorMessage(e)}`));
  }

  // ───────────── persistence ─────────────

  private file(id: string) {
    return path.join(this.dir, `${id}.json`);
  }

  /** Serialised per trial; write-then-rename so a crash never leaves half a file. */
  private save(s: Session): Promise<void> {
    s.saveChain = s.saveChain
      .then(async () => {
        const saved: SavedTrial = s.voice.seq > 0 ? { ...s.engine.state, voiceUsage: s.voice } : s.engine.state;
        const json = JSON.stringify(saved);
        await mkdir(this.dir, { recursive: true });
        const tmp = `${this.file(s.id)}.${process.pid}.tmp`;
        await writeFile(tmp, json, "utf8");
        await rename(tmp, this.file(s.id));
      })
      .catch((e) => console.error(`[trials] could not save ${s.id}: ${errorMessage(e)}`));
    return s.saveChain;
  }
}

export type { Session };
