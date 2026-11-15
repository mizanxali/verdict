/**
 * The trial state machine. Code owns all state: models return free text (actors) or small
 * structured verdicts (scorers), and this file validates and applies them. The decisions
 * themselves live in rules.ts as pure functions; this layer sequences llm calls around them.
 */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  InvalidActionError,
  type ActorRequest,
  type ActorResult,
  type ConfrontRequest,
  type CreateTrial,
  type CreateTrialOptions,
  type Llm,
  type LlmContext,
  type RulingRequest,
  type TrialEngine,
} from "../shared/contracts";
import {
  Confront as ConfrontSchema,
  DEFAULT_BUDGETS,
  FactCheck as FactCheckSchema,
  RuleCheck as RuleCheckSchema,
  Ruling as RulingSchema,
  type Budgets,
  type CaseFile,
  type EntryKind,
  type FactCheck,
  type Lie,
  type ObjectionType,
  type Phase,
  type PlayerAction,
  type RecordEntry,
  type RuleCheck,
  type Ruling,
  type Side,
  type Speaker,
  type TrialEvent,
  type TrialState,
  type Witness,
} from "../shared/types";
import {
  adjustCredibility,
  applyJuryUpdate,
  buildWitnessBrief,
  claimPenalty,
  computeVerdict,
  crackCandidates,
  flaggedClaims,
  initialState,
  loopStepIndex,
  loopTotal,
  nextPhase,
  playerCrossWitnessIndex,
  prosecutionLoop,
  validateAction,
  validateJuryUpdate,
  type CrackCandidate,
  type FlaggedClaim,
} from "./rules";
import { TUNING } from "./tuning";
import { publicEntry, toPlayerView } from "./view";

const PLAYER: Speaker = { kind: "player" };
const PROSECUTOR: Speaker = { kind: "prosecutor" };
const JUDGE: Speaker = { kind: "judge" };
const CLERK: Speaker = { kind: "clerk" };

export const NOTICE_REPHRASE = "The judge asks counsel to rephrase.";
export const LINE_ALLOW_IT = "I'll allow it.";

const OBJECTION_LABEL: Record<ObjectionType, string> = {
  relevance: "relevance",
  hearsay: "hearsay",
  leading: "leading the witness",
  speculation: "calls for speculation",
  assumes_facts: "assumes facts not in evidence",
  badgering: "counsel is badgering the witness",
};

/** A witness answer started before the gate scorers return. Its tokens are held back. */
interface Speculation {
  abort: AbortController;
  buffer: string[];
  entryId: string | null; // set once released to the player
  result: Promise<ActorResult>;
}

interface Checks {
  fact: Promise<FactCheck | null>;
  rule: Promise<RuleCheck | null>;
}

function cleanBudgets(partial: Partial<Budgets> | undefined): Budgets {
  const out: Budgets = { ...DEFAULT_BUDGETS };
  for (const k of Object.keys(out) as (keyof Budgets)[]) {
    const v = partial?.[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
  }
  return out;
}

function parseOrNull<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> | null {
  if (value == null) return null;
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}

const dedupe = (ids: readonly string[]) => [...new Set(ids)];

class Trial implements TrialEngine {
  private s: TrialState;
  private readonly cf: CaseFile;
  private readonly llm: Llm;
  private readonly sink: (e: TrialEvent) => void;
  private busy = false;
  private juryChain: Promise<void> = Promise.resolve();
  /** Background fact/rule checks on the prosecutor question awaiting the player's objection. */
  private pendingChecks = new Map<string, Checks>();

  constructor(opts: CreateTrialOptions) {
    this.cf = opts.caseFile;
    this.llm = opts.llm;
    this.sink = opts.emit;
    if (opts.state) {
      if (opts.state.pending === null && opts.state.phase !== "verdict")
        throw new Error("can only resume a trial that is waiting for the player or finished");
      if (opts.state.caseId !== opts.caseFile.id)
        throw new Error(`saved trial is for case ${opts.state.caseId}, not ${opts.caseFile.id}`);
      this.s = structuredClone(opts.state);
    } else {
      this.s = initialState(this.cf, cleanBudgets(opts.budgets), opts.id ?? randomUUID(), new Date().toISOString());
    }
    // NOTE: onUsage lives on the Llm object, so an Llm instance must not be shared between trials.
    this.llm.onUsage = (u) => {
      this.s.usage.push({ ...u });
    };
  }

  get state(): TrialState {
    return this.s;
  }

  view() {
    return toPlayerView(this.s, this.cf);
  }

  async act(action: PlayerAction): Promise<void> {
    if (this.busy) throw new InvalidActionError("another action is in progress");
    const err = validateAction(this.s, this.cf, action);
    if (err) throw new InvalidActionError(err);
    this.busy = true;
    this.s.pending = null;
    try {
      await this.dispatch(action);
    } finally {
      this.busy = false;
    }
  }

  async idle(): Promise<void> {
    let tail: Promise<void>;
    do {
      tail = this.juryChain;
      await tail;
    } while (tail !== this.juryChain);
  }

  // ───────────────────────── Dispatch and phases ─────────────────────────

  private async dispatch(a: PlayerAction): Promise<void> {
    switch (a.type) {
      case "begin":
        return this.enter("opening");
      case "opening":
        await this.playerStatement(a.text, this.allExhibits());
        return this.enter("w1_direct");
      case "ask":
        return this.playerQuestion(a.text, a.exhibitIds);
      case "end_cross":
        return this.advance();
      case "object":
        return this.prosecutionAnswer(a.ground);
      case "pass":
        return this.prosecutionAnswer(null);
      case "closing":
        await this.playerStatement(a.text, [...this.s.admitted]);
        return this.enter("verdict");
    }
  }

  private advance(): Promise<void> {
    return this.enter(nextPhase(this.s.phase));
  }

  private async enter(phase: Phase): Promise<void> {
    this.s.phase = phase;

    if (phase === "opening") {
      const entry = await this.prosecutorSpeaks("statement", [], { role: "prosecutor", task: "opening" }, this.pointsLine(this.cf.prosecution.openingPoints));
      this.commit(entry);
      await this.checkStatement(entry, "prosecution", this.allExhibits());
      return this.wait("opening");
    }

    const loop = prosecutionLoop(phase);
    if (loop) {
      const w = this.cf.witnesses[loop.witnessIndex]!;
      this.s.witnessId = w.id;
      this.s.questionsLeft = loopTotal(this.cf, this.s.budgets, phase);
      this.narrate(
        phase === "w3_cross"
          ? `The defendant, ${w.name}, takes the stand. The prosecution will cross-examine.`
          : `The prosecution calls ${w.name}, ${w.role}.`,
      );
      if (this.s.questionsLeft <= 0) return this.advance();
      return this.askProsecutorQuestion();
    }

    if (playerCrossWitnessIndex(phase) !== null) {
      this.s.questionsLeft = this.s.budgets.crossQuestions;
      this.narrate("Your witness.");
      if (this.s.questionsLeft <= 0) return this.advance();
      return this.wait("question");
    }

    if (phase === "closing") {
      this.s.witnessId = null;
      this.s.questionsLeft = 0;
      const entry = await this.prosecutorSpeaks("statement", [], { role: "prosecutor", task: "closing" }, this.pointsLine(this.cf.prosecution.closingPoints));
      this.commit(entry);
      await this.checkStatement(entry, "prosecution", [...this.s.admitted]);
      return this.wait("closing");
    }

    if (phase === "verdict") {
      this.s.witnessId = null;
      this.s.questionsLeft = 0;
      await this.idle();
      this.s.verdict = computeVerdict(this.cf, this.s.jurors);
      this.s.endedAt = new Date().toISOString();
      this.s.pending = null;
      this.emitState();
      return;
    }

    throw new Error(`cannot enter phase ${phase}`);
  }

  private wait(pending: Exclude<TrialState["pending"], null>): void {
    this.s.pending = pending;
    this.emitState();
  }

  // ───────────────────────── Openings and closings ─────────────────────────

  private async playerStatement(text: string, allowed: string[]): Promise<void> {
    const entry = this.makeEntry(PLAYER, "statement", text.trim());
    this.write(entry);
    await this.checkStatement(entry, "defence", allowed);
  }

  private async checkStatement(entry: RecordEntry, side: Side, allowed: string[]): Promise<void> {
    const fc = await this.factCheck(entry, side, allowed);
    this.applyFactCheck(entry, side, fc);
    this.emitState();
    this.queueJury([entry]);
  }

  // ───────────────────────── Prosecutor question loop ─────────────────────────

  private currentWitness(): Witness {
    const w = this.cf.witnesses.find((x) => x.id === this.s.witnessId);
    if (!w) throw new Error("no witness on the stand");
    return w;
  }

  private async askProsecutorQuestion(): Promise<void> {
    const loop = prosecutionLoop(this.s.phase)!;
    const w = this.currentWitness();
    const step = (this.cf.prosecution.plan[w.id] ?? [])[loopStepIndex(this.cf, this.s)]!;
    const known = new Set(this.cf.evidence.map((e) => e.id));
    const exhibitIds = dedupe(step.exhibitIds.filter((id) => known.has(id)));

    const entry = await this.prosecutorSpeaks(
      "question",
      exhibitIds,
      {
        role: "prosecutor",
        task: "question",
        witnessId: w.id,
        mode: loop.mode,
        step: { topic: step.topic, exhibitIds },
        questionsLeft: this.s.questionsLeft,
      },
      `Please tell the court about ${step.topic.replace(/[.?!\s]+$/, "")}.`,
    );
    this.present(entry, w.id, exhibitIds, "prosecution");
    this.commit(entry);
    this.pendingChecks.set(entry.id, this.startChecks(entry, "prosecution", loop.mode, w.id));
    this.wait("objection_window");
  }

  /** The player objected (ground) or passed (null) on the prosecutor's question. */
  private async prosecutionAnswer(ground: ObjectionType | null): Promise<void> {
    const loop = prosecutionLoop(this.s.phase)!;
    const w = this.currentWitness();
    const question = this.s.record.findLast((e) => e.kind === "question" && e.speaker.kind === "prosecutor");
    if (!question) throw new Error("no prosecutor question to answer");
    const exchange: RecordEntry[] = [question];
    let answers = true;

    if (ground) {
      const objection = this.makeEntry(PLAYER, "objection", this.objectionText(ground));
      this.write(objection);
      exchange.push(objection);
      // Same treatment as the player gets: the judge sees what the fact-checker found.
      const priorFc = ground === "assumes_facts" ? await this.pendingChecks.get(question.id)?.fact : null;
      const ruling = await this.ruling({
        objector: "defence",
        ground,
        entry: question,
        mode: loop.mode,
        witnessId: w.id,
        flaggedClaims: flaggedClaims(priorFc ?? null).map((c) => ({ text: c.text, verdict: c.verdict })),
      });
      const line = await this.judgeLine(ruling, "defence");
      if (ruling?.sustained) {
        question.stricken = true;
        line.tags.push({ type: "objection_sustained", by: "defence", ground }, { type: "question_withdrawn", by: "prosecution" });
        this.credit("prosecution", TUNING.credibility.sustainedObjection);
        answers = false;
      } else if (ruling) {
        line.tags.push({ type: "objection_overruled", by: "defence", ground });
        this.credit("defence", TUNING.credibility.overruledObjection);
      }
      this.commit(line);
      exchange.push(line);
      this.emitState();
    }

    if (answers) {
      const answer = await this.crackAndAnswer(w, question, "prosecution", loop.mode, question.exhibitIds);
      if (answer) exchange.push(answer);
    }

    const checks = this.pendingChecks.get(question.id) ?? this.startChecks(question, "prosecution", loop.mode, w.id);
    this.pendingChecks.delete(question.id);
    const [fc] = await Promise.all([checks.fact, checks.rule]);
    this.applyFactCheck(question, "prosecution", fc);
    this.queueJury(exchange);

    // Plan steps always advance, even after a refused answer, so a stubborn model cannot loop the trial.
    this.s.questionsLeft--;
    this.emitState();
    if (this.s.questionsLeft <= 0) return this.advance();
    return this.askProsecutorQuestion();
  }

  // ───────────────────────── Player cross-examination ─────────────────────────

  private async playerQuestion(text: string, rawIds: string[]): Promise<void> {
    const w = this.currentWitness();
    const exhibitIds = dedupe(rawIds);
    const question = this.makeEntry(PLAYER, "question", text.trim(), exhibitIds);
    this.present(question, w.id, exhibitIds, "defence");
    this.write(question);
    this.emitState();

    const checks = this.startChecks(question, "defence", "cross", w.id);
    const candidates = crackCandidates(w, this.s.lieStatus, this.s.shown[w.id] ?? [], exhibitIds);
    // A question that could break a lie is never answered speculatively: the brief may change.
    const spec = candidates.length === 0 ? this.speculate(w, question, "defence", "cross") : null;

    const [fc, rc] = await Promise.all([checks.fact, checks.rule]);
    const flagged = this.applyFactCheck(question, "defence", fc);
    const ground = gateGround(flagged, rc);
    const exchange: RecordEntry[] = [question];
    let proceeds = true;

    if (ground) {
      const objection = this.makeEntry(PROSECUTOR, "objection", this.objectionText(ground));
      this.write(objection);
      exchange.push(objection);
      const ruling = await this.ruling({
        objector: "prosecution",
        ground,
        entry: question,
        mode: "cross",
        witnessId: w.id,
        flaggedClaims: flaggedClaims(fc).map((c) => ({ text: c.text, verdict: c.verdict })),
      });
      if (ruling?.sustained) spec?.abort.abort(); // stop paying for an answer nobody will hear
      const line = await this.judgeLine(ruling, "prosecution");
      if (ruling?.sustained) {
        question.stricken = true;
        line.tags.push({ type: "objection_sustained", by: "prosecution", ground });
        this.credit("defence", TUNING.credibility.sustainedObjection);
        proceeds = false;
      } else if (ruling) {
        line.tags.push({ type: "objection_overruled", by: "prosecution", ground });
        this.credit("prosecution", TUNING.credibility.overruledObjection);
      }
      this.commit(line);
      exchange.push(line);
      this.emitState();
    }

    let spent = true;
    if (proceeds) {
      const answer = spec
        ? await this.releaseSpeculation(spec, w, question, "defence")
        : await this.crackAndAnswer(w, question, "defence", "cross", exhibitIds);
      if (answer) exchange.push(answer);
      else spent = false; // refused: the question is struck and the budget is not charged
    }

    if (spent) this.s.questionsLeft--;
    if (spent || exchange.some((e) => e.tags.length > 0)) this.queueJury(exchange);
    this.emitState();
    if (this.s.questionsLeft <= 0) return this.advance();
    return this.wait("question");
  }

  // ───────────────────────── Witness answers and lie-cracking ─────────────────────────

  private witnessRequest(w: Witness, question: RecordEntry, examiner: Side, mode: "direct" | "cross", cracking: Lie[]): ActorRequest {
    return {
      role: "witness",
      brief: buildWitnessBrief(w, this.s.lieStatus, new Set(cracking.map((l) => l.id))),
      examiner,
      mode,
      question: structuredClone(question),
    };
  }

  private speculate(w: Witness, question: RecordEntry, examiner: Side, mode: "direct" | "cross"): Speculation {
    const spec: Speculation = { abort: new AbortController(), buffer: [], entryId: null, result: Promise.resolve({ text: "", refused: true }) };
    spec.result = this.callActor(
      this.ctxBefore(question.id),
      this.witnessRequest(w, question, examiner, mode, []),
      (t) => {
        if (spec.entryId) this.emit({ type: "token", entryId: spec.entryId, text: t });
        else spec.buffer.push(t);
      },
      spec.abort.signal,
    );
    return spec;
  }

  private async releaseSpeculation(spec: Speculation, w: Witness, question: RecordEntry, examiner: Side): Promise<RecordEntry | null> {
    const id = this.nextId();
    const speaker: Speaker = { kind: "witness", witnessId: w.id };
    this.emit({ type: "entry_start", entryId: id, speaker, kind: "answer", exhibitIds: [] });
    for (const t of spec.buffer) this.emit({ type: "token", entryId: id, text: t });
    spec.buffer = [];
    spec.entryId = id;
    const res = await spec.result;
    if (res.refused) this.emit({ type: "entry_discard", entryId: id });
    return this.finishAnswer(id, res.refused ? null : res.text, w, question, examiner, []);
  }

  /** Lie-cracking (confront) then a live witness answer. Used whenever we did not speculate. */
  private async crackAndAnswer(
    w: Witness,
    question: RecordEntry,
    examiner: Side,
    mode: "direct" | "cross",
    attached: string[],
  ): Promise<RecordEntry | null> {
    const candidates = crackCandidates(w, this.s.lieStatus, this.s.shown[w.id] ?? [], attached);
    const cracking = await this.confrontAll(candidates, w, question);
    const id = this.nextId();
    const text = await this.streamText(
      id,
      { type: "entry_start", entryId: id, speaker: { kind: "witness", witnessId: w.id }, kind: "answer", exhibitIds: [] },
      this.ctxBefore(question.id),
      this.witnessRequest(w, question, examiner, mode, cracking),
    );
    return this.finishAnswer(id, text, w, question, examiner, cracking);
  }

  private async confrontAll(candidates: CrackCandidate[], w: Witness, question: RecordEntry): Promise<Lie[]> {
    const results = await Promise.all(
      candidates.map(async ({ lie, breakers }) => {
        for (const b of breakers) {
          const r = await this.confront(lie.id, {
            witnessId: w.id,
            lieId: lie.id,
            coverStory: lie.coverStory,
            mustConfront: b.mustConfront,
            exhibitIds: [...b.exhibitIds],
            entry: question,
          });
          if (r?.confronted) return lie;
        }
        return null;
      }),
    );
    return results.filter((l): l is Lie => l !== null);
  }

  /**
   * Commits a witness answer. Cracks are applied only here, once the concession has actually been
   * made on the record; a refused turn leaves every lie as it was.
   */
  private finishAnswer(id: string, text: string | null, w: Witness, question: RecordEntry, examiner: Side, cracking: Lie[]): RecordEntry | null {
    if (text === null) {
      question.stricken = true;
      this.emit({ type: "notice", text: NOTICE_REPHRASE });
      this.emitState();
      return null;
    }
    const answer = this.makeEntry({ kind: "witness", witnessId: w.id }, "answer", text, [], id);
    for (const lie of cracking) {
      this.s.lieStatus[lie.id] = "cracked";
      answer.tags.push({ type: "lie_cracked", lieId: lie.id, witnessId: w.id, by: examiner, label: lie.label });
    }
    this.commit(answer);
    this.emitState();
    return answer;
  }

  // ───────────────────────── Shared helpers: record ─────────────────────────

  private nextId(): string {
    return `r${this.s.record.length + 1}`;
  }

  private makeEntry(speaker: Speaker, kind: EntryKind, text: string, exhibitIds: string[] = [], id = this.nextId()): RecordEntry {
    return { id, phase: this.s.phase, speaker, kind, text, exhibitIds: [...exhibitIds], stricken: false, tags: [] };
  }

  /** Code-written entry: start and end, no tokens. */
  private write(entry: RecordEntry): void {
    this.emit({ type: "entry_start", entryId: entry.id, speaker: entry.speaker, kind: entry.kind, exhibitIds: [...entry.exhibitIds] });
    this.commit(entry);
  }

  /** Appends an entry whose entry_start has already been emitted. */
  private commit(entry: RecordEntry): void {
    this.s.record.push(entry);
    this.emit({ type: "entry_end", entry: publicEntry(entry) });
  }

  private narrate(text: string): void {
    this.write(this.makeEntry(CLERK, "narration", text));
    this.emitState();
  }

  /** Marks exhibits admitted in court and shown to this witness; tags first admissions. */
  private present(entry: RecordEntry, witnessId: string, ids: string[], by: Side): void {
    const shown = (this.s.shown[witnessId] ??= []);
    for (const id of ids) {
      if (!this.s.admitted.includes(id)) {
        this.s.admitted.push(id);
        entry.tags.push({ type: "exhibit_admitted", by, exhibitId: id });
      }
      if (!shown.includes(id)) shown.push(id);
    }
  }

  private credit(side: Side, delta: number): void {
    this.s.credibility = adjustCredibility(this.s.credibility, side, delta);
  }

  private applyFactCheck(entry: RecordEntry, side: Side, fc: FactCheck | null): FlaggedClaim[] {
    if (!fc) return [];
    entry.factCheck = fc;
    // Only a speech can give the case away; a question cannot.
    if (fc.concedesOwnCase && entry.kind === "statement") entry.tags.push({ type: "concession", by: side });
    const flagged = flaggedClaims(fc);
    for (const c of flagged) {
      entry.tags.push({ type: "claim_flagged", by: side, verdict: c.verdict, claim: c.text });
      this.credit(side, claimPenalty(c.verdict));
    }
    return flagged;
  }

  private objectionText(ground: ObjectionType): string {
    const rule = this.cf.rules.objections.find((o) => o.type === ground);
    return `Objection, Your Honour: ${rule?.name ?? OBJECTION_LABEL[ground]}.`;
  }

  private pointsLine(points: string[]): string {
    return points.length ? `Members of the jury. ${points.join(" ")}` : "Members of the jury, the prosecution rests on the evidence.";
  }

  private allExhibits(): string[] {
    return this.cf.evidence.map((e) => e.id);
  }

  // ───────────────────────── Shared helpers: events ─────────────────────────

  private emit(e: TrialEvent): void {
    try {
      this.sink(e);
    } catch {
      // A broken listener must never corrupt the trial.
    }
  }

  private emitState(): void {
    this.emit({ type: "state", view: this.view() });
  }

  // ───────────────────────── llm calls (all wrapped) ─────────────────────────

  private ctx(upto = this.s.record.length): LlmContext {
    return { caseFile: this.cf, record: structuredClone(this.s.record.slice(0, upto)) };
  }

  /** The record before an entry: the entry under scrutiny travels in the request, not ctx. */
  private ctxBefore(entryId: string): LlmContext {
    const i = this.s.record.findIndex((e) => e.id === entryId);
    return this.ctx(i < 0 ? undefined : i);
  }

  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T, signal?: AbortSignal): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!signal?.aborted) this.emit({ type: "error", message: `${label} failed: ${err instanceof Error ? err.message : String(err)}` });
      return fallback;
    }
  }

  /** Never rejects. A throw, a refusal or an empty reply all come back as refused. */
  private async callActor(ctx: LlmContext, req: ActorRequest, onToken: (t: string) => void, signal?: AbortSignal): Promise<ActorResult> {
    const refused: ActorResult = { text: "", refused: true };
    const res = await this.safe(`actor:${req.role}`, () => this.llm.actor(ctx, req, onToken, signal), refused, signal);
    if (!res || typeof res.text !== "string" || res.refused || res.text.trim() === "") return refused;
    return { text: res.text, refused: false };
  }

  /** Streams a model-written entry. Returns its text, or null (after entry_discard) if refused. */
  private async streamText(id: string, start: Extract<TrialEvent, { type: "entry_start" }>, ctx: LlmContext, req: ActorRequest): Promise<string | null> {
    this.emit(start);
    const res = await this.callActor(ctx, req, (t) => this.emit({ type: "token", entryId: id, text: t }));
    if (res.refused) {
      this.emit({ type: "entry_discard", entryId: id });
      return null;
    }
    return res.text;
  }

  /** Prosecutor speaks: one retry on refusal, then a code-written line so the trial never stalls. */
  private async prosecutorSpeaks(kind: EntryKind, exhibitIds: string[], req: ActorRequest, fallback: string): Promise<RecordEntry> {
    const ctx = this.ctx();
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = this.nextId();
      const text = await this.streamText(id, { type: "entry_start", entryId: id, speaker: PROSECUTOR, kind, exhibitIds: [...exhibitIds] }, ctx, req);
      if (text !== null) return this.makeEntry(PROSECUTOR, kind, text, exhibitIds, id);
    }
    const entry = this.makeEntry(PROSECUTOR, kind, fallback, exhibitIds);
    this.emit({ type: "entry_start", entryId: entry.id, speaker: PROSECUTOR, kind, exhibitIds: [...exhibitIds] });
    return entry;
  }

  /** The judge's spoken line for a ruling (entry_start emitted, not yet committed). */
  private async judgeLine(ruling: Ruling | null, objector: Side): Promise<RecordEntry> {
    if (ruling) {
      const id = this.nextId();
      const text = await this.streamText(
        id,
        { type: "entry_start", entryId: id, speaker: JUDGE, kind: "ruling", exhibitIds: [] },
        this.ctx(),
        { role: "judge", task: "ruling_line", ruling, objector },
      );
      if (text !== null) return this.makeEntry(JUDGE, "ruling", text, [], id);
    }
    const entry = this.makeEntry(JUDGE, "ruling", ruling ? (ruling.sustained ? "Sustained." : "Overruled.") : LINE_ALLOW_IT);
    this.emit({ type: "entry_start", entryId: entry.id, speaker: JUDGE, kind: "ruling", exhibitIds: [] });
    return entry;
  }

  private factCheck(entry: RecordEntry, speaker: Side, allowed: string[]): Promise<FactCheck | null> {
    const ctx = this.ctxBefore(entry.id);
    const req = { speaker, entry: structuredClone(entry), allowedExhibitIds: dedupe(allowed) };
    return this.safe("factCheck", async () => parseOrNull(FactCheckSchema, await this.llm.factCheck(ctx, req)), null);
  }

  private startChecks(entry: RecordEntry, speaker: Side, mode: "direct" | "cross", witnessId: string): Checks {
    const ctx = this.ctxBefore(entry.id);
    const req = { speaker, entry: structuredClone(entry), mode, witnessId };
    return {
      fact: this.factCheck(entry, speaker, [...this.s.admitted]),
      rule: this.safe("ruleCheck", async () => parseOrNull(RuleCheckSchema, await this.llm.ruleCheck(ctx, req)), null),
    };
  }

  private ruling(req: RulingRequest): Promise<Ruling | null> {
    const ctx = this.ctxBefore(req.entry.id);
    const r = { ...req, entry: structuredClone(req.entry) };
    return this.safe(
      "ruling",
      async () => {
        const out = parseOrNull(RulingSchema, await this.llm.ruling(ctx, r));
        return out ? { ...out, objection: req.ground } : null;
      },
      null,
    );
  }

  private confront(lieId: string, req: ConfrontRequest): Promise<{ confronted: boolean } | null> {
    const ctx = this.ctxBefore(req.entry.id);
    const r = { ...req, entry: structuredClone(req.entry) };
    return this.safe(
      "confront",
      async () => {
        const out = parseOrNull(ConfrontSchema, await this.llm.confront(ctx, r));
        return out && out.lieId === lieId ? out : null;
      },
      null,
    );
  }

  // ───────────────────────── Jury (serialized background chain) ─────────────────────────

  private queueJury(exchange: RecordEntry[]): void {
    if (!exchange.length) return;
    const ids = exchange.map((e) => e.id);
    const upto = Math.max(...ids.map((id) => this.s.record.findIndex((e) => e.id === id)));
    if (upto < 0) return;
    const record = structuredClone(this.s.record.slice(0, upto + 1));
    const entries = record.filter((e) => ids.includes(e.id));
    const tags = entries.flatMap((e) => e.tags);
    this.juryChain = this.juryChain
      .then(() => this.runJury(record, entries, tags))
      .catch((err) => this.emit({ type: "error", message: `jury update failed: ${err instanceof Error ? err.message : String(err)}` }));
  }

  private async runJury(record: RecordEntry[], exchange: RecordEntry[], tags: RecordEntry["tags"]): Promise<void> {
    const uptoEntryId = record[record.length - 1]!.id;
    const leansBefore = Object.fromEntries(this.cf.jurors.map((j) => [j.id, this.s.jurors[j.id]?.lean ?? j.startLean]));
    const req = {
      exchange,
      tags,
      jurors: this.cf.jurors.map((j) => ({ id: j.id, name: j.name, persona: j.persona, disposition: j.disposition, lean: leansBefore[j.id]! })),
    };
    const raw = await this.safe("juryUpdate", () => this.llm.juryUpdate({ caseFile: this.cf, record }, req), null);
    const result = validateJuryUpdate(raw, this.cf.jurors.map((j) => j.id));
    this.s.juryCalls.push({ uptoEntryId, exchangeEntryIds: exchange.map((e) => e.id), tags, leansBefore, result });
    if (result) this.s.jurors = applyJuryUpdate(this.s.jurors, result, this.s.credibility, uptoEntryId, tags);
    this.emitState();
  }
}

/** The prosecution objects to a player question when the gate scorers flag it. */
export function gateGround(flagged: FlaggedClaim[], rc: RuleCheck | null): ObjectionType | null {
  if (flagged.length) return "assumes_facts";
  return rc?.violations.find((v) => v.severity === "clear")?.objection ?? null;
}

export const createTrial: CreateTrial = (opts) => new Trial(opts);
