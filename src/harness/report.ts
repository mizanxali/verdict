/** Plain-text rendering of a finished trial: transcript, outcome, jury log and usage. */
import { usageTotals } from "../engine/view";
import type { CaseFile, EventTag, RecordEntry, Speaker, TrialState, UsageEntry, UsageTotals } from "../shared/types";

export function speakerName(cf: CaseFile, s: Speaker): string {
  switch (s.kind) {
    case "player":
      return "DEFENCE";
    case "prosecutor":
      return `PROSECUTOR (${cf.prosecution.name})`;
    case "judge":
      return `JUDGE (${cf.judge.name})`;
    case "clerk":
      return "CLERK";
    case "witness":
      return (cf.witnesses.find((w) => w.id === s.witnessId)?.name ?? s.witnessId).toUpperCase();
  }
}

export function formatTag(t: EventTag): string {
  switch (t.type) {
    case "lie_cracked":
      return `lie_cracked(${t.lieId} by ${t.by})`;
    case "concession":
      return `concession(${t.by})`;
    case "claim_flagged":
      return `claim_flagged(${t.by}, ${t.verdict}: "${clip(t.claim, 80)}")`;
    case "objection_sustained":
      return `objection_sustained(${t.by}: ${t.ground})`;
    case "objection_overruled":
      return `objection_overruled(${t.by}: ${t.ground})`;
    case "question_withdrawn":
      return `question_withdrawn(${t.by})`;
    case "exhibit_admitted":
      return `exhibit_admitted(${t.exhibitId} by ${t.by})`;
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const indent = (s: string, pad = "    ") => s.split("\n").map((l) => pad + l).join("\n");

export function formatEntry(cf: CaseFile, e: RecordEntry): string {
  const head = [`[${e.id}] ${e.phase} ${speakerName(cf, e.speaker)} ${e.kind}`];
  if (e.exhibitIds.length) head.push(`exhibits: ${e.exhibitIds.join(", ")}`);
  if (e.stricken) head.push("STRICKEN");
  const lines = [head.join(" | "), indent(e.text)];
  if (e.tags.length) lines.push(`    tags: ${e.tags.map(formatTag).join("; ")}`);
  const flagged = e.factCheck?.claims.filter((c) => c.verdict !== "supported") ?? [];
  if (flagged.length) lines.push(...flagged.map((c) => `    fact-check: ${c.verdict}: "${clip(c.text, 100)}" (${c.reason})`));
  return lines.join("\n");
}

export function formatTranscript(state: TrialState, cf: CaseFile): string {
  return ["=== TRANSCRIPT ===", ...state.record.map((e) => formatEntry(cf, e))].join("\n\n");
}

export function formatOutcome(state: TrialState, cf: CaseFile): string {
  const out: string[] = ["=== OUTCOME ==="];
  out.push("Lies:");
  for (const w of cf.witnesses)
    for (const l of w.lies) out.push(`  ${state.lieStatus[l.id] === "cracked" ? "EXPOSED" : "held   "} ${w.name}: ${l.label} (${l.id})`);
  out.push(`Credibility: defence ${state.credibility.defence}, prosecution ${state.credibility.prosecution}`);
  out.push("", "Jurors (lean -10 convict .. +10 acquit):");
  for (const j of cf.jurors) {
    const s = state.jurors[j.id];
    out.push(`  ${j.name} (${j.id}): start ${j.startLean}, final ${s?.lean ?? j.startLean}, acquits at >= ${j.acquitAt}`);
    for (const c of s?.log ?? []) {
      const tags = c.tags.filter((t) => t.type !== "exhibit_admitted").map(formatTag);
      out.push(
        `    ${c.entryId}: raw ${signed(c.rawDelta)} -> ${signed(c.delta)} = ${c.leanAfter}  ${c.reason}${tags.length ? `  [${tags.join("; ")}]` : ""}`,
      );
    }
  }
  const v = state.verdict;
  out.push("", `VERDICT: ${v ? v.outcome.toUpperCase().replace("_", " ") : "(none)"}`);
  if (v) for (const vote of v.votes) out.push(`  ${vote.jurorId}: ${vote.vote} (final lean ${vote.finalLean})`);
  return out.join("\n");
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

// ───────────────────────── Usage ─────────────────────────

export interface UsageSummary extends UsageTotals {
  /** cacheRead / (input + cacheRead + cacheWrite); 0 when there was no input at all. */
  cacheReadShare: number;
  wallMs: number;
  byCall: ({ call: string; ms: number } & UsageTotals)[];
}

export function summarizeUsage(usage: readonly UsageEntry[], wallMs: number): UsageSummary {
  const totals = usageTotals(usage);
  const groups = new Map<string, UsageEntry[]>();
  for (const u of usage) groups.set(u.call, [...(groups.get(u.call) ?? []), u]);
  const byCall = [...groups.entries()]
    .map(([call, us]) => ({ call, ms: us.reduce((s, u) => s + u.ms, 0), ...usageTotals(us) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls || a.call.localeCompare(b.call));
  const allInput = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return { ...totals, cacheReadShare: allInput ? totals.cacheReadTokens / allInput : 0, wallMs, byCall };
}

export function formatUsage(u: UsageSummary, title = "USAGE"): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `=== ${title} ===`,
    `calls ${u.calls} | input ${u.inputTokens} | cache read ${u.cacheReadTokens} | cache write ${u.cacheWriteTokens} | output ${u.outputTokens}`,
    `cache-read share ${pct(u.cacheReadShare)} | refusals ${u.refusals} | cost $${u.costUsd.toFixed(4)} | wall ${(u.wallMs / 1000).toFixed(1)}s`,
    "",
    `${"call".padEnd(28)} ${"calls".padStart(5)} ${"input".padStart(8)} ${"c.read".padStart(9)} ${"c.write".padStart(8)} ${"output".padStart(7)} ${"refused".padStart(7)} ${"cost $".padStart(8)} ${"model s".padStart(8)}`,
  ];
  for (const c of u.byCall)
    lines.push(
      `${c.call.padEnd(28)} ${String(c.calls).padStart(5)} ${String(c.inputTokens).padStart(8)} ${String(c.cacheReadTokens).padStart(9)} ${String(c.cacheWriteTokens).padStart(8)} ${String(c.outputTokens).padStart(7)} ${String(c.refusals).padStart(7)} ${c.costUsd.toFixed(4).padStart(8)} ${(c.ms / 1000).toFixed(1).padStart(8)}`,
    );
  return lines.join("\n");
}
