/**
 * Regression checks over finished trial states. Pure functions of (state, case file, script),
 * plus an Llm for the two checks that need model calls (the leak check and the jury
 * consistency replay). Each check collects the usage of its own calls.
 *
 * Jury maths are the engine's own exported rules (applyJuryUpdate, which applies scaleDelta and
 * clampLean; validateJuryUpdate; computeVerdict; adjustCredibility; claimPenalty). The one thing
 * not stored per jury call is the credibility the engine used when it applied the update, so it
 * is rebuilt from the credibility-moving tags on the record up to the call's last entry (see
 * credibilityAt). The consistency check verifies that reconstruction by replaying the ORIGINAL
 * stored results and comparing the leans with the saved state.
 */
import { adjustCredibility, applyJuryUpdate, claimPenalty, computeVerdict, validateJuryUpdate } from "../engine/rules";
import { TUNING } from "../engine/tuning";
import type { Llm } from "../shared/contracts";
import {
  LeakCheck as LeakCheckSchema,
  type CaseFile,
  type JuryUpdate,
  type RecordEntry,
  type Side,
  type TrialState,
  type UsageEntry,
  type Verdict,
} from "../shared/types";
import type { Script } from "./script";

export interface Criterion {
  ok: boolean;
  text: string;
}

export interface CheckResult {
  name: string;
  pass: boolean;
  criteria: Criterion[];
  notes: string[];
  /** Model calls made by the check itself (not the trial). */
  usage: UsageEntry[];
  data?: Record<string, unknown>;
}

function result(name: string, criteria: Criterion[], notes: string[], usage: UsageEntry[], data?: Record<string, unknown>): CheckResult {
  return { name, pass: criteria.length > 0 && criteria.every((c) => c.ok), criteria, notes, usage, data };
}

/** Points the Llm's usage hook at a fresh array (the Llm must not be in use by a trial). */
function collectUsage(llm: Llm): UsageEntry[] {
  const usage: UsageEntry[] = [];
  llm.onUsage = (u) => usage.push({ ...u });
  return usage;
}

// ───────────────────────── Record helpers ─────────────────────────

const PLAYER_CROSS = new Set(["w1_cross", "w2_cross"]);

const crackedLies = (state: TrialState) => Object.entries(state.lieStatus).filter(([, s]) => s === "cracked").map(([id]) => id);

/** The entries that belong to the question at index i: up to the next question, statement or narration. */
export function exchangeOf(record: readonly RecordEntry[], i: number): RecordEntry[] {
  const out = [record[i]!];
  for (let k = i + 1; k < record.length; k++) {
    const e = record[k]!;
    if (e.kind === "question" || e.kind === "statement" || e.kind === "narration") break;
    out.push(e);
  }
  return out;
}

const isFlagged = (e: RecordEntry) =>
  e.tags.some((t) => t.type === "claim_flagged" && t.by === "defence") || (e.factCheck?.claims ?? []).some((c) => c.verdict !== "supported");

/** Player entries produced by a script item (marker injection only appends, so match by prefix). */
function entriesFor(state: TrialState, text: string, kind: "question" | "statement", phases?: Set<string>): number[] {
  const t = text.trim();
  const out: number[] = [];
  state.record.forEach((e, i) => {
    if (e.speaker.kind === "player" && e.kind === kind && (!phases || phases.has(e.phase)) && e.text.startsWith(t)) out.push(i);
  });
  return out;
}

// ───────────────────────── Leak check ─────────────────────────

export interface LeakReport {
  checked: number;
  leaks: { answerId: string; witnessId: string; lieId: string; quote: string }[];
  /** Answers the grader returned null (refused/failed) or malformed output for. */
  unscored: string[];
}

/**
 * For every witness answer in the player's crosses, asks llm.leakCheck whether it abandoned a lie
 * the code still marked as held at that moment (cracks up to and including that answer excluded).
 */
export async function leakCheckCrosses(state: TrialState, cf: CaseFile, llm: Llm): Promise<LeakReport> {
  const report: LeakReport = { checked: 0, leaks: [], unscored: [] };
  const crackedSoFar = new Set<string>();
  for (let i = 0; i < state.record.length; i++) {
    const answer = state.record[i]!;
    for (const t of answer.tags) if (t.type === "lie_cracked") crackedSoFar.add(t.lieId);
    if (answer.kind !== "answer" || answer.speaker.kind !== "witness" || !PLAYER_CROSS.has(answer.phase)) continue;
    const wid = answer.speaker.witnessId;
    const w = cf.witnesses.find((x) => x.id === wid);
    const qi = state.record.findLastIndex((e, k) => k < i && e.kind === "question" && e.speaker.kind === "player");
    if (!w || qi < 0) continue;
    const heldLies = w.lies.filter((l) => !crackedSoFar.has(l.id)).map((l) => ({ id: l.id, coverStory: l.coverStory, truth: l.truth }));
    if (!heldLies.length) continue;
    report.checked++;
    let raw: unknown = null;
    try {
      raw = await llm.leakCheck(
        { caseFile: cf, record: structuredClone(state.record.slice(0, qi)) },
        { witnessName: w.name, heldLies, question: structuredClone(state.record[qi]!), answer: structuredClone(answer) },
      );
    } catch {
      raw = null;
    }
    const parsed = raw == null ? null : LeakCheckSchema.safeParse(raw);
    if (!parsed?.success) {
      report.unscored.push(answer.id);
      continue;
    }
    for (const l of parsed.data.leaks) if (l.abandoned) report.leaks.push({ answerId: answer.id, witnessId: wid, lieId: l.lieId, quote: l.quote });
  }
  return report;
}

function leakCriteria(r: LeakReport): Criterion[] {
  return [
    {
      ok: r.checked > 0 && r.unscored.length === 0,
      text: `leak grader scored ${r.checked - r.unscored.length}/${r.checked} cross answers${r.unscored.length ? ` (unscored: ${r.unscored.join(", ")})` : ""}`,
    },
    {
      ok: r.leaks.length === 0,
      text: r.leaks.length
        ? `held lies abandoned in prose: ${r.leaks.map((l) => `${l.answerId}/${l.lieId} "${l.quote}"`).join("; ")}`
        : "no answer abandoned a held lie",
    },
  ];
}

// ───────────────────────── bluff ─────────────────────────

export async function checkBluff(state: TrialState, cf: CaseFile, llm: Llm): Promise<CheckResult> {
  const usage = collectUsage(llm);
  const cracked = crackedLies(state);
  const leak = await leakCheckCrosses(state, cf, llm);
  const criteria: Criterion[] = [
    { ok: cracked.length === 0, text: cracked.length ? `lies cracked without a breaker: ${cracked.join(", ")}` : "no lie cracked" },
    ...leakCriteria(leak),
  ];
  return result("bluff", criteria, [], usage, { leak });
}

// ───────────────────────── invented ─────────────────────────

export async function checkInvented(state: TrialState, cf: CaseFile, script: Script, llm: Llm): Promise<CheckResult> {
  const usage = collectUsage(llm);
  const notes: string[] = [];
  const cracked = crackedLies(state);
  const criteria: Criterion[] = [
    { ok: cracked.length === 0, text: cracked.length ? `lies cracked: ${cracked.join(", ")}` : "no lie cracked" },
  ];

  // Which record entries carry the script's invented claims.
  const items: { label: string; idx: number[]; question: boolean }[] = [];
  for (const [wid, qs] of Object.entries(script.crosses))
    qs.forEach((q, i) => {
      if (q.invented) items.push({ label: `${wid}[${i}]`, idx: entriesFor(state, q.text, "question", PLAYER_CROSS), question: true });
    });
  for (const which of ["opening", "closing"] as const)
    if (script[which].invented) items.push({ label: which, idx: entriesFor(state, script[which].text, "statement"), question: false });

  const asked = items.filter((it) => it.idx.length > 0);
  for (const it of items) if (!it.idx.length) notes.push(`invented item ${it.label} never reached the record (budget?)`);
  const unflagged = asked.filter((it) => !it.idx.every((i) => isFlagged(state.record[i]!)));
  criteria.push({
    ok: asked.length > 0 && unflagged.length === 0,
    text: `fact-checker flagged ${asked.length - unflagged.length}/${asked.length} invented items${unflagged.length ? ` (missed: ${unflagged.map((u) => u.label).join(", ")})` : ""}`,
  });

  // Prosecution objections to the invented questions, and whether they were struck.
  let objected = 0;
  const notStruck: string[] = [];
  for (const it of asked.filter((x) => x.question))
    for (const i of it.idx) {
      const ex = exchangeOf(state.record, i);
      if (!ex.some((e) => e.kind === "objection" && e.speaker.kind === "prosecutor")) continue;
      objected++;
      const sustained = ex.some((e) => e.tags.some((t) => t.type === "objection_sustained" && t.by === "prosecution"));
      if (!(sustained && state.record[i]!.stricken)) notStruck.push(`${it.label} (${state.record[i]!.id})`);
    }
  criteria.push({
    ok: objected > 0 && notStruck.length === 0,
    text: `prosecution objected to ${objected} invented question(s); ${objected - notStruck.length} sustained and stricken${notStruck.length ? ` (not stricken: ${notStruck.join(", ")})` : ""}`,
  });

  const leak = await leakCheckCrosses(state, cf, llm);
  criteria.push(...leakCriteria(leak));

  // No juror may move toward the defence on an exchange carrying a defence claim flag.
  const bad: string[] = [];
  let flaggedChanges = 0;
  for (const j of cf.jurors)
    for (const c of state.jurors[j.id]?.log ?? []) {
      if (!c.tags.some((t) => t.type === "claim_flagged" && t.by === "defence")) continue;
      flaggedChanges++;
      if (c.delta > 0) bad.push(`${j.id}@${c.entryId} ${c.delta > 0 ? "+" : ""}${c.delta}`);
    }
  criteria.push({
    ok: bad.length === 0,
    text: bad.length
      ? `jurors moved toward the defence on flagged exchanges: ${bad.join(", ")}`
      : `no juror moved toward the defence on a flagged exchange (${flaggedChanges} juror reactions)`,
  });
  return result("invented", criteria, notes, usage, { leak });
}

// ───────────────────────── real ─────────────────────────

export function checkReal(state: TrialState, cf: CaseFile): CheckResult {
  const lies = cf.witnesses.filter((w) => w.calledBy === "prosecution").flatMap((w) => w.lies);
  const held = lies.filter((l) => state.lieStatus[l.id] !== "cracked").map((l) => l.id);
  const tagged = new Set(
    state.record.flatMap((e) => e.tags).flatMap((t) => (t.type === "lie_cracked" && t.by === "defence" ? [t.lieId] : [])),
  );
  const untagged = lies.filter((l) => !tagged.has(l.id)).map((l) => l.id);

  let net = 0;
  const perJuror: string[] = [];
  for (const j of cf.jurors) {
    let sum = 0;
    for (const c of state.jurors[j.id]?.log ?? [])
      if (c.tags.some((t) => t.type === "lie_cracked" && t.by === "defence")) sum += c.delta;
    net += sum;
    perJuror.push(`${j.id} ${sum >= 0 ? "+" : ""}${sum}`);
  }
  const criteria: Criterion[] = [
    { ok: held.length === 0, text: held.length ? `prosecution lies still held: ${held.join(", ")}` : `all ${lies.length} prosecution lies cracked` },
    {
      ok: untagged.length === 0,
      text: untagged.length ? `no defence lie_cracked tag for: ${untagged.join(", ")}` : "each crack carries a lie_cracked tag by defence",
    },
    { ok: net > 0, text: `net jury movement on crack exchanges ${net >= 0 ? "+" : ""}${net} (${perJuror.join(", ")})` },
  ];
  return result("real", criteria, [], [], { net });
}

// ───────────────────────── consistency ─────────────────────────

/**
 * Credibility as of a record index, replayed from the tags that move it in the engine:
 * claim_flagged (speaker penalised), a sustained objection (the questioner's side), an overruled
 * objection (the objector). Approximation: the engine applies a jury update when its background
 * chain reaches it, which may be after later credibility changes; this uses the record position.
 */
export function credibilityAt(record: readonly RecordEntry[], idx: number): Record<Side, number> {
  let cred: Record<Side, number> = { defence: TUNING.credibility.start, prosecution: TUNING.credibility.start };
  const other = (s: Side): Side => (s === "defence" ? "prosecution" : "defence");
  for (const e of record.slice(0, idx + 1))
    for (const t of e.tags) {
      if (t.type === "claim_flagged") cred = adjustCredibility(cred, t.by, claimPenalty(t.verdict));
      if (t.type === "objection_sustained") cred = adjustCredibility(cred, other(t.by), TUNING.credibility.sustainedObjection);
      if (t.type === "objection_overruled") cred = adjustCredibility(cred, t.by, TUNING.credibility.overruledObjection);
    }
  return cred;
}

/** Applies a sequence of jury results (one per stored call) from the jurors' start leans. */
export function replayJury(state: TrialState, cf: CaseFile, results: (JuryUpdate | null)[]): { jurors: TrialState["jurors"]; verdict: Verdict } {
  let jurors: TrialState["jurors"] = Object.fromEntries(cf.jurors.map((j) => [j.id, { lean: j.startLean, log: [] }]));
  state.juryCalls.forEach((call, k) => {
    const r = results[k];
    if (!r) return;
    const idx = state.record.findIndex((e) => e.id === call.uptoEntryId);
    jurors = applyJuryUpdate(jurors, r, credibilityAt(state.record, idx), call.uptoEntryId, call.tags);
  });
  return { jurors, verdict: computeVerdict(cf, jurors) };
}

export async function checkConsistency(state: TrialState, cf: CaseFile, llm: Llm, runs: number): Promise<CheckResult> {
  const usage = collectUsage(llm);
  const notes: string[] = [];
  const ids = cf.jurors.map((j) => j.id);

  // Self-check: the stored results, replayed with the reconstructed credibility, must give the saved leans.
  const base = replayJury(state, cf, state.juryCalls.map((c) => c.result));
  const mismatched = ids.filter((id) => base.jurors[id]!.lean !== state.jurors[id]?.lean);
  notes.push(
    mismatched.length
      ? `credibility reconstruction does NOT reproduce the saved leans for ${mismatched.join(", ")}; recomputed leans are approximate`
      : "replaying the original stored jury results with the reconstructed credibility reproduces the saved final leans",
  );

  const one = async (k: number): Promise<JuryUpdate | null> => {
    const call = state.juryCalls[k]!;
    const idx = state.record.findIndex((e) => e.id === call.uptoEntryId);
    const record = state.record.slice(0, idx + 1);
    const exchange = record.filter((e) => call.exchangeEntryIds.includes(e.id));
    try {
      const raw = await llm.juryUpdate(structuredClone({ caseFile: cf, record }), {
        exchange: structuredClone(exchange),
        tags: structuredClone(call.tags),
        jurors: cf.jurors.map((j) => ({ id: j.id, name: j.name, persona: j.persona, disposition: j.disposition, lean: call.leansBefore[j.id] ?? j.startLean })),
      });
      return validateJuryUpdate(raw, ids);
    } catch {
      return null;
    }
  };

  // results[run][call]. Per call: the first run alone (writes the prompt cache), then the rest in parallel.
  const results: (JuryUpdate | null)[][] = Array.from({ length: runs }, () => []);
  for (let k = 0; k < state.juryCalls.length; k++) {
    if (runs > 0) results[0]![k] = await one(k);
    const rest = await Promise.all(Array.from({ length: Math.max(0, runs - 1) }, () => one(k)));
    rest.forEach((r, i) => (results[i + 1]![k] = r));
  }

  const replays = results.map((rs) => replayJury(state, cf, rs));
  const verdicts = replays.map((r) => r.verdict.outcome);
  const sameVerdict = verdicts.every((v) => v === verdicts[0]);
  const spread: Record<string, number> = {};
  for (const id of ids) {
    const leans = replays.map((r) => r.jurors[id]!.lean);
    spread[id] = Math.max(...leans) - Math.min(...leans);
  }
  const wide = ids.filter((id) => spread[id]! > 1);

  let agree = 0;
  let total = 0;
  let nulls = 0;
  for (let k = 0; k < state.juryCalls.length; k++) {
    for (const id of ids) {
      const ds = results.map((rs) => rs[k]?.jurors.find((j) => j.jurorId === id)?.delta ?? null);
      total++;
      if (ds.every((d) => d === ds[0])) agree++;
    }
    nulls += results.filter((rs) => !rs[k]).length;
  }
  if (nulls) notes.push(`${nulls} replayed jury call(s) returned null (no lean moved for that call in that run)`);
  notes.push(`original trial verdict: ${state.verdict?.outcome ?? "(none)"}`);
  for (const [i, r] of replays.entries())
    notes.push(`run ${i + 1}: ${r.verdict.outcome}; leans ${ids.map((id) => `${id} ${r.jurors[id]!.lean}`).join(", ")}`);

  const criteria: Criterion[] = [
    { ok: runs > 0 && state.juryCalls.length > 0, text: `${runs} run(s) x ${state.juryCalls.length} stored jury calls replayed` },
    { ok: sameVerdict, text: `verdict across runs: ${verdicts.join(", ")}` },
    {
      ok: wide.length === 0,
      text: `max final-lean spread per juror: ${ids.map((id) => `${id} ${spread[id]}`).join(", ")}${wide.length ? ` (over 1: ${wide.join(", ")})` : ""}`,
    },
  ];
  const agreement = total ? agree / total : 0;
  notes.push(`per-call delta agreement: ${agree}/${total} juror-calls identical across all runs (${(agreement * 100).toFixed(1)}%)`);
  return result("consistency", criteria, notes, usage, { agreement, verdicts, spread, reconstructionExact: mismatched.length === 0 });
}
