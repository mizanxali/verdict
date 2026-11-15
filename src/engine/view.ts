import type { ToPlayerView } from "../shared/contracts";
import type { CaseFile, PlayerView, RecordEntry, TrialState, UsageEntry, UsageTotals } from "../shared/types";

export function usageTotals(usage: readonly UsageEntry[]): UsageTotals {
  const t: UsageTotals = {
    calls: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    refusals: 0,
  };
  for (const u of usage) {
    t.calls++;
    t.inputTokens += u.inputTokens;
    t.cacheReadTokens += u.cacheReadTokens;
    t.cacheWriteTokens += u.cacheWriteTokens;
    t.outputTokens += u.outputTokens;
    t.costUsd += u.costUsd;
    if (u.refused) t.refusals++;
  }
  return t;
}

/** A deep copy of an entry fit for the browser: factCheck survives only on the player's own entries. */
export function publicEntry(e: RecordEntry): RecordEntry {
  const { factCheck, ...rest } = e;
  const copy = structuredClone(rest);
  return e.speaker.kind === "player" && factCheck ? { ...copy, factCheck: structuredClone(factCheck) } : copy;
}

/**
 * What the browser may see. Built field by field from an allow-list, so anything added to
 * TrialState or CaseFile later stays private by default.
 */
export const toPlayerView: ToPlayerView = (state: TrialState, caseFile: CaseFile): PlayerView => {
  const record = state.record.map(publicEntry);

  const exposedLies: PlayerView["exposedLies"] = [];
  for (const w of caseFile.witnesses)
    for (const l of w.lies)
      if (state.lieStatus[l.id] === "cracked") exposedLies.push({ lieId: l.id, witnessId: w.id, label: l.label });

  const result: PlayerView["result"] =
    state.phase === "verdict" && state.verdict
      ? {
          verdict: structuredClone(state.verdict),
          replay: caseFile.jurors.map((j) => ({
            jurorId: j.id,
            name: j.name,
            startLean: j.startLean,
            acquitAt: j.acquitAt,
            log: structuredClone(state.jurors[j.id]?.log ?? []),
          })),
        }
      : null;

  return {
    id: state.id,
    phase: state.phase,
    pending: state.pending,
    witnessId: state.witnessId,
    questionsLeft: state.questionsLeft,
    record,
    admitted: [...state.admitted],
    exposedLies,
    credibility: { ...state.credibility },
    usage: usageTotals(state.usage),
    caseInfo: {
      title: caseFile.title,
      charge: caseFile.charge,
      defendantName: caseFile.defendantName,
      publicBrief: caseFile.publicBrief,
      rules: structuredClone(caseFile.rules),
      evidence: caseFile.evidence.map((e) => ({ id: e.id, title: e.title, kind: e.kind, text: e.text })),
      witnesses: caseFile.witnesses.map((w) => ({
        id: w.id,
        name: w.name,
        role: w.role,
        calledBy: w.calledBy,
        publicStatement: w.publicStatement,
      })),
      jurors: caseFile.jurors.map((j) => ({ id: j.id, name: j.name, persona: j.persona })),
      prosecutorName: caseFile.prosecution.name,
      judgeName: caseFile.judge.name,
    },
    result,
  };
};
