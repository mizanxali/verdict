/**
 * API-call estimate for a scripted trial, derived from the engine's calls per exchange
 * (src/engine/engine.ts) and the script's budgets. It walks the trial the way the engine
 * would, using the engine's own crack-candidate rule to count confront calls.
 */
import { crackCandidates, loopTotal, prosecutionLoop } from "../engine/rules";
import type { Budgets, CaseFile, Phase, TrialState } from "../shared/types";
import { policyFor, type Script, type ScriptQuestion } from "./script";

export const ESTIMATE_ASSUMPTIONS = [
  "Each opening/closing statement: 1 fact-check + 1 jury call; the prosecutor's two statements add 1 actor call each (5 calls per statement pair).",
  "Each prosecutor question: prosecutor actor + fact-check + rule-check + witness actor + jury = 5; an objection by the script adds ruling + judge line (+2, assumed overruled so the answer is still given).",
  "Each player cross question: fact-check + rule-check + witness actor + jury = 4; a question the script expects to be objected to (invented, or a [violation]/[unsupported] fake marker) adds ruling + judge line (+2).",
  "Confront calls: 1 per breaker whose exhibits are satisfied on a question, by the engine's own crackCandidates(); a question marked to confront cracks the lie on its first breaker, any other leaves it held. Prosecutor-presented breakers are counted as 1 call each and assumed not to crack.",
  "No refusals, re-asks, scorer retries (each scorer retries once on a refusal or invalid output) or prosecutor retries; each would add calls.",
  "Cross lists longer than the cross budget are cut at the budget; shorter lists end with end_cross (no call).",
];

export interface TrialEstimate {
  total: number;
  parts: { label: string; calls: number }[];
  /** Jury scorer calls in the trial: one per exchange. The consistency check replays these. */
  juryCalls: number;
  /** Witness answers in the player's crosses (upper bound): one leak check each. */
  crossAnswers: number;
}

const expectsObjection = (q: ScriptQuestion) => q.invented || q.fakeMarkers.some((m) => /^\[(violation:\w+|unsupported|contradicted)\]$/.test(m));

export function estimateTrial(script: Script, cf: CaseFile, budgets: Budgets): TrialEstimate {
  const parts: TrialEstimate["parts"] = [];
  const lieStatus: TrialState["lieStatus"] = Object.fromEntries(cf.witnesses.flatMap((w) => w.lies.map((l) => [l.id, "held" as const])));
  const shown: Record<string, string[]> = Object.fromEntries(cf.witnesses.map((w) => [w.id, []]));
  let juryCalls = 0;
  let crossAnswers = 0;

  parts.push({ label: "openings", calls: 5 });
  juryCalls += 2;

  const phases: Phase[] = ["w1_direct", "w1_cross", "w2_direct", "w2_cross", "w3_cross"];
  for (const phase of phases) {
    const loop = prosecutionLoop(phase);
    if (loop) {
      const w = cf.witnesses[loop.witnessIndex]!;
      const n = loopTotal(cf, budgets, phase);
      let calls = 0;
      for (let i = 0; i < n; i++) {
        const step = cf.prosecution.plan[w.id]![i]!;
        for (const id of step.exhibitIds) if (!shown[w.id]!.includes(id)) shown[w.id]!.push(id);
        calls += 5;
        if (policyFor(script, w.id, i).action === "object") calls += 2;
        calls += crackCandidates(w, lieStatus, shown[w.id]!, step.exhibitIds).reduce((s, c) => s + c.breakers.length, 0);
      }
      juryCalls += n;
      parts.push({ label: `${phase} (${w.id}, ${n} prosecutor questions)`, calls });
      continue;
    }
    const w = cf.witnesses[phase === "w1_cross" ? 0 : 1]!;
    const list = (script.crosses[w.id] ?? []).slice(0, budgets.crossQuestions);
    let calls = 0;
    for (const q of list) {
      for (const id of q.exhibitIds) if (!shown[w.id]!.includes(id)) shown[w.id]!.push(id);
      calls += 4;
      if (expectsObjection(q)) calls += 2;
      const confronts = q.fakeMarkers.includes("[confront]");
      for (const c of crackCandidates(w, lieStatus, shown[w.id]!, q.exhibitIds)) {
        if (confronts) {
          calls += 1;
          lieStatus[c.lie.id] = "cracked";
        } else calls += c.breakers.length;
      }
    }
    juryCalls += list.length;
    crossAnswers += list.length;
    parts.push({ label: `${phase} (${w.id}, ${list.length} player questions)`, calls });
  }

  parts.push({ label: "closings", calls: 5 });
  juryCalls += 2;
  return { total: parts.reduce((s, p) => s + p.calls, 0), parts, juryCalls, crossAnswers };
}

export function formatEstimate(name: string, e: TrialEstimate): string {
  return [`${name}: ~${e.total} API calls`, ...e.parts.map((p) => `  ${p.label}: ${p.calls}`)].join("\n");
}
