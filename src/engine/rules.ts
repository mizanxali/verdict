/**
 * Pure trial rules: no I/O, no llm, no mutation of inputs unless stated.
 * The async orchestration in engine.ts is a thin layer on top of these.
 */
import type { WitnessBrief } from "../shared/contracts";
import {
  ObjectionType,
  type Breaker,
  type Budgets,
  type CaseFile,
  type FactCheck,
  type JuryUpdate,
  type Lie,
  type Phase,
  type PlayerAction,
  type Side,
  type TrialState,
  type Verdict,
  type Witness,
} from "../shared/types";
import { JuryUpdate as JuryUpdateSchema } from "../shared/types";
import { TUNING } from "./tuning";

// ───────────────────────── Phases ─────────────────────────

const ORDER: Phase[] = [
  "case_review",
  "opening",
  "w1_direct",
  "w1_cross",
  "w2_direct",
  "w2_cross",
  "w3_cross",
  "closing",
  "verdict",
];

export function nextPhase(phase: Phase): Phase {
  const i = ORDER.indexOf(phase);
  return ORDER[Math.min(i + 1, ORDER.length - 1)]!;
}

/** Phases where the prosecutor asks questions from the plan and the player may object. */
export interface ProsecutionLoop {
  witnessIndex: number;
  mode: "direct" | "cross";
  budgetKey: "directQuestions" | "clientCrossQuestions";
}

export function prosecutionLoop(phase: Phase): ProsecutionLoop | null {
  switch (phase) {
    case "w1_direct":
      return { witnessIndex: 0, mode: "direct", budgetKey: "directQuestions" };
    case "w2_direct":
      return { witnessIndex: 1, mode: "direct", budgetKey: "directQuestions" };
    case "w3_cross":
      return { witnessIndex: 2, mode: "cross", budgetKey: "clientCrossQuestions" };
    default:
      return null;
  }
}

/** Phases where the player cross-examines a prosecution witness. */
export function playerCrossWitnessIndex(phase: Phase): number | null {
  return phase === "w1_cross" ? 0 : phase === "w2_cross" ? 1 : null;
}

/** Number of prosecutor questions in a loop phase: the plan, capped by the budget. */
export function loopTotal(caseFile: CaseFile, budgets: Budgets, phase: Phase): number {
  const loop = prosecutionLoop(phase);
  if (!loop) return 0;
  const witness = caseFile.witnesses[loop.witnessIndex];
  if (!witness) return 0;
  const plan = caseFile.prosecution.plan[witness.id] ?? [];
  return Math.max(0, Math.min(plan.length, budgets[loop.budgetKey]));
}

/** Index of the plan step in play, derived from questionsLeft so it survives a resume. */
export function loopStepIndex(caseFile: CaseFile, state: Pick<TrialState, "budgets" | "phase" | "questionsLeft">): number {
  return loopTotal(caseFile, state.budgets, state.phase) - state.questionsLeft;
}

// ───────────────────────── Action validation ─────────────────────────

const ALLOWED: Record<Exclude<TrialState["pending"], null>, PlayerAction["type"][]> = {
  begin: ["begin"],
  opening: ["opening"],
  question: ["ask", "end_cross"],
  objection_window: ["object", "pass"],
  closing: ["closing"],
};

/** Returns an error message, or null when the action is legal right now. Never mutates. */
export function validateAction(state: TrialState, caseFile: CaseFile, action: unknown): string | null {
  if (state.pending === null) return state.phase === "verdict" ? "the trial is over" : "the engine is busy";
  if (!action || typeof action !== "object" || typeof (action as { type?: unknown }).type !== "string")
    return "malformed action";
  const a = action as PlayerAction;
  if (!ALLOWED[state.pending].includes(a.type))
    return `action "${a.type}" not allowed while waiting for "${state.pending}"`;

  const textOk = (t: unknown, max: number): string | null => {
    if (typeof t !== "string" || t.trim().length === 0) return "text must be a non-empty string";
    if (t.length > max) return `text longer than ${max} characters`;
    return null;
  };
  switch (a.type) {
    case "opening":
    case "closing":
      return textOk(a.text, TUNING.limits.maxStatementChars);
    case "ask": {
      const err = textOk(a.text, TUNING.limits.maxQuestionChars);
      if (err) return err;
      if (!Array.isArray(a.exhibitIds)) return "exhibitIds must be an array";
      const known = new Set(caseFile.evidence.map((e) => e.id));
      for (const id of a.exhibitIds as unknown[]) {
        if (typeof id !== "string" || !known.has(id)) return `unknown exhibit ${String(id)}`;
      }
      return null;
    }
    case "object":
      return ObjectionType.safeParse(a.ground).success ? null : `unknown objection ground ${String(a.ground)}`;
    default:
      return null;
  }
}

// ───────────────────────── Lies, breakers, briefs ─────────────────────────

/** A breaker's precondition: all its exhibits shown to this witness, at least one on this question. */
export function breakerSatisfied(breaker: Breaker, shown: readonly string[], attached: readonly string[]): boolean {
  return breaker.exhibitIds.every((id) => shown.includes(id)) && breaker.exhibitIds.some((id) => attached.includes(id));
}

export interface CrackCandidate {
  lie: Lie;
  /** Breakers whose precondition holds, in case-file order. */
  breakers: Breaker[];
}

/** Held lies of this witness that the current question could break, pending a confront check. */
export function crackCandidates(
  witness: Witness,
  lieStatus: TrialState["lieStatus"],
  shown: readonly string[],
  attached: readonly string[],
): CrackCandidate[] {
  const out: CrackCandidate[] = [];
  for (const lie of witness.lies) {
    if ((lieStatus[lie.id] ?? "held") !== "held") continue;
    const breakers = lie.breakers.filter((b) => breakerSatisfied(b, shown, attached));
    if (breakers.length) out.push({ lie, breakers });
  }
  return out;
}

/**
 * The only private knowledge a witness actor ever receives. A held lie carries its cover story
 * and topic and nothing else: the actor cannot concede a truth it was never given.
 */
export function buildWitnessBrief(
  witness: Witness,
  lieStatus: TrialState["lieStatus"],
  justCracked: ReadonlySet<string> = new Set(),
): WitnessBrief {
  return {
    witnessId: witness.id,
    name: witness.name,
    role: witness.role,
    persona: witness.persona,
    publicStatement: witness.publicStatement,
    knows: [...witness.knows],
    lies: witness.lies.map((lie) => {
      const cracking = justCracked.has(lie.id);
      const cracked = cracking || lieStatus[lie.id] === "cracked";
      return cracked
        ? {
            id: lie.id,
            topic: lie.topic,
            status: "cracked" as const,
            coverStory: lie.coverStory,
            truth: lie.truth,
            concession: lie.concession,
            justCracked: cracking,
          }
        : { id: lie.id, topic: lie.topic, status: "held" as const, coverStory: lie.coverStory, justCracked: false };
    }),
  };
}

// ───────────────────────── Credibility ─────────────────────────

export function clampCredibility(n: number): number {
  return Math.max(TUNING.credibility.min, Math.min(TUNING.credibility.max, n));
}

/** Returns new credibility; does not mutate. */
export function adjustCredibility(cred: Record<Side, number>, side: Side, delta: number): Record<Side, number> {
  return { ...cred, [side]: clampCredibility(cred[side] + delta) };
}

export type FlaggedClaim = FactCheck["claims"][number] & { verdict: "unsupported" | "contradicted" };

export function flaggedClaims(fc: FactCheck | null): FlaggedClaim[] {
  return (fc?.claims ?? []).filter((c): c is FlaggedClaim => c.verdict === "unsupported" || c.verdict === "contradicted");
}

export function claimPenalty(verdict: "unsupported" | "contradicted"): number {
  return verdict === "contradicted" ? TUNING.credibility.contradictedClaim : TUNING.credibility.unsupportedClaim;
}

// ───────────────────────── Jury maths ─────────────────────────

/** Exactly the case's juror IDs, once each, integer deltas within range. Otherwise null. */
export function validateJuryUpdate(result: unknown, jurorIds: readonly string[]): JuryUpdate | null {
  const parsed = JuryUpdateSchema.safeParse(result);
  if (!parsed.success) return null;
  const ids = parsed.data.jurors.map((j) => j.jurorId);
  if (ids.length !== jurorIds.length || new Set(ids).size !== ids.length) return null;
  if (!jurorIds.every((id) => ids.includes(id))) return null;
  if (!parsed.data.jurors.every((j) => Number.isInteger(j.delta) && Math.abs(j.delta) <= TUNING.jury.maxDelta))
    return null;
  return parsed.data;
}

/** A side with low credibility gets its favourable deltas halved toward zero. */
export function scaleDelta(raw: number, credibility: Record<Side, number>): number {
  const half = (d: number) => Math.trunc(d / 2) || 0; // `|| 0` avoids -0
  if (raw > 0 && credibility.defence < TUNING.jury.lowCredibility) return half(raw);
  if (raw < 0 && credibility.prosecution < TUNING.jury.lowCredibility) return half(raw);
  return raw;
}

export function clampLean(n: number): number {
  return Math.max(TUNING.jury.leanMin, Math.min(TUNING.jury.leanMax, n));
}

/**
 * Applies a validated jury update. Returns the new jurors map; does not mutate the input.
 * A LeanChange is kept when the raw delta moved, or when the exchange carried tags
 * (a reasoned "no change" on a real event is worth showing in the replay).
 */
export function applyJuryUpdate(
  jurors: TrialState["jurors"],
  update: JuryUpdate,
  credibility: Record<Side, number>,
  entryId: string,
  tags: TrialState["record"][number]["tags"],
): TrialState["jurors"] {
  const out: TrialState["jurors"] = {};
  for (const [id, j] of Object.entries(jurors)) out[id] = { lean: j.lean, log: [...j.log] };
  for (const d of update.jurors) {
    const j = out[d.jurorId];
    if (!j) continue;
    const before = j.lean;
    const after = clampLean(before + scaleDelta(d.delta, credibility));
    j.lean = after;
    if (d.delta !== 0 || tags.length > 0)
      j.log.push({ entryId, rawDelta: d.delta, delta: after - before, leanAfter: after, reason: d.reason, tags: [...tags] });
  }
  return out;
}

export function computeVerdict(caseFile: CaseFile, jurors: TrialState["jurors"]): Verdict {
  const votes = caseFile.jurors.map((j) => {
    const finalLean = jurors[j.id]?.lean ?? j.startLean;
    return { jurorId: j.id, vote: finalLean >= j.acquitAt ? ("not_guilty" as const) : ("guilty" as const), finalLean };
  });
  const ng = votes.filter((v) => v.vote === "not_guilty").length;
  const g = votes.length - ng;
  const need = TUNING.jury.votesForVerdict;
  return { outcome: ng >= need ? "not_guilty" : g >= need ? "guilty" : "hung", votes };
}

// ───────────────────────── Initial state ─────────────────────────

export function initialState(caseFile: CaseFile, budgets: Budgets, id: string, now: string): TrialState {
  return {
    id,
    caseId: caseFile.id,
    budgets,
    phase: "case_review",
    pending: "begin",
    witnessId: null,
    questionsLeft: 0,
    record: [],
    admitted: [],
    shown: Object.fromEntries(caseFile.witnesses.map((w) => [w.id, []])),
    lieStatus: Object.fromEntries(caseFile.witnesses.flatMap((w) => w.lies.map((l) => [l.id, "held" as const]))),
    credibility: { defence: TUNING.credibility.start, prosecution: TUNING.credibility.start },
    jurors: Object.fromEntries(caseFile.jurors.map((j) => [j.id, { lean: j.startLean, log: [] }])),
    juryCalls: [],
    usage: [],
    verdict: null,
    startedAt: now,
    endedAt: null,
  };
}
