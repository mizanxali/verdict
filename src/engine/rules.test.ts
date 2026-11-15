import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, type Phase } from "../shared/types";
import { fixtureCase } from "./fixture";
import {
  adjustCredibility,
  applyJuryUpdate,
  breakerSatisfied,
  buildWitnessBrief,
  computeVerdict,
  crackCandidates,
  initialState,
  loopTotal,
  nextPhase,
  scaleDelta,
  validateAction,
  validateJuryUpdate,
} from "./rules";

const cf = fixtureCase();
const fresh = () => initialState(cf, DEFAULT_BUDGETS, "t", "now");
const ids = cf.jurors.map((j) => j.id);

describe("phases", () => {
  it("runs in trial order and stops at verdict", () => {
    let p: Phase = "case_review";
    const seen: Phase[] = [p];
    while (p !== "verdict") seen.push((p = nextPhase(p)));
    expect(seen).toEqual(["case_review", "opening", "w1_direct", "w1_cross", "w2_direct", "w2_cross", "w3_cross", "closing", "verdict"]);
    expect(nextPhase("verdict")).toBe("verdict");
  });

  it("caps prosecutor loops by plan length and budget", () => {
    expect(loopTotal(cf, DEFAULT_BUDGETS, "w1_direct")).toBe(2);
    expect(loopTotal(cf, { ...DEFAULT_BUDGETS, directQuestions: 1 }, "w1_direct")).toBe(1);
    expect(loopTotal(cf, { ...DEFAULT_BUDGETS, clientCrossQuestions: 0 }, "w3_cross")).toBe(0);
    expect(loopTotal(cf, DEFAULT_BUDGETS, "w1_cross")).toBe(0);
  });
});

describe("validateAction", () => {
  it("matches the action to pending", () => {
    const s = fresh();
    expect(validateAction(s, cf, { type: "begin" })).toBeNull();
    expect(validateAction(s, cf, { type: "pass" })).toMatch(/not allowed/);
    expect(validateAction(s, cf, null)).toMatch(/malformed/);
    expect(validateAction({ ...s, pending: null }, cf, { type: "begin" })).toMatch(/busy/);
  });

  it("rejects unknown exhibits, empty text and bad grounds", () => {
    const s = { ...fresh(), pending: "question" as const };
    expect(validateAction(s, cf, { type: "ask", text: "Q?", exhibitIds: ["E1"] })).toBeNull();
    expect(validateAction(s, cf, { type: "ask", text: "Q?", exhibitIds: ["E99"] })).toMatch(/unknown exhibit/);
    expect(validateAction(s, cf, { type: "ask", text: "  ", exhibitIds: [] })).toMatch(/non-empty/);
    const o = { ...fresh(), pending: "objection_window" as const };
    expect(validateAction(o, cf, { type: "object", ground: "rudeness" })).toMatch(/unknown objection/);
    expect(validateAction(o, cf, { type: "object", ground: "hearsay" })).toBeNull();
  });
});

describe("breakers", () => {
  const okafor = cf.witnesses[1]!;
  const b = okafor.lies[0]!.breakers[0]!; // needs E1 and E4

  it("needs every exhibit shown and at least one attached now", () => {
    expect(breakerSatisfied(b, ["E1", "E4"], ["E4"])).toBe(true);
    expect(breakerSatisfied(b, ["E1", "E4"], [])).toBe(false); // shown earlier, nothing attached now
    expect(breakerSatisfied(b, ["E4"], ["E4"])).toBe(false); // E1 never shown
    expect(breakerSatisfied(b, ["E1", "E4", "E2"], ["E2"])).toBe(false); // attached exhibit is irrelevant
  });

  it("ignores lies already cracked", () => {
    const s = fresh();
    expect(crackCandidates(okafor, s.lieStatus, ["E1", "E4"], ["E1"])).toHaveLength(1);
    expect(crackCandidates(okafor, { ...s.lieStatus, L2: "cracked" }, ["E1", "E4"], ["E1"])).toHaveLength(0);
  });
});

describe("buildWitnessBrief", () => {
  const renn = cf.witnesses[0]!;

  it("gives a held lie only its cover story and topic", () => {
    const brief = buildWitnessBrief(renn, fresh().lieStatus);
    expect(brief.lies[0]).toEqual({ id: "L1", topic: renn.lies[0]!.topic, status: "held", coverStory: renn.lies[0]!.coverStory, justCracked: false });
    expect("truth" in brief.lies[0]!).toBe(false);
    expect("concession" in brief.lies[0]!).toBe(false);
    expect(JSON.stringify(brief)).not.toMatch(/TRUTH_|CONCESSION_|LABEL_/);
  });

  it("releases truth and concession when cracking, flagged justCracked once", () => {
    const now = buildWitnessBrief(renn, fresh().lieStatus, new Set(["L1"]));
    expect(now.lies[0]).toMatchObject({ status: "cracked", justCracked: true, truth: renn.lies[0]!.truth, concession: renn.lies[0]!.concession });
    const later = buildWitnessBrief(renn, { ...fresh().lieStatus, L1: "cracked" });
    expect(later.lies[0]).toMatchObject({ status: "cracked", justCracked: false });
  });
});

describe("credibility", () => {
  it("clamps to 0..100", () => {
    expect(adjustCredibility({ defence: 3, prosecution: 98 }, "defence", -10).defence).toBe(0);
    expect(adjustCredibility({ defence: 3, prosecution: 98 }, "prosecution", 10).prosecution).toBe(100);
  });
});

describe("jury maths", () => {
  const ok = { jurors: ids.map((id) => ({ jurorId: id, delta: 1, reason: "r" })) };

  it("accepts exactly the five jurors with integer deltas in range", () => {
    expect(validateJuryUpdate(ok, ids)).not.toBeNull();
    expect(validateJuryUpdate({ jurors: ok.jurors.slice(0, 4) }, ids)).toBeNull();
    expect(validateJuryUpdate({ jurors: [...ok.jurors.slice(0, 4), { ...ok.jurors[0]! }] }, ids)).toBeNull();
    expect(validateJuryUpdate({ jurors: ok.jurors.map((j) => ({ ...j, delta: 3 })) }, ids)).toBeNull();
    expect(validateJuryUpdate({ jurors: ok.jurors.map((j) => ({ ...j, delta: 1.5 })) }, ids)).toBeNull();
    expect(validateJuryUpdate({ jurors: ok.jurors.map((j, i) => ({ ...j, jurorId: i ? j.jurorId : "x" })) }, ids)).toBeNull();
    expect(validateJuryUpdate(null, ids)).toBeNull();
  });

  it("halves a low-credibility side's favourable deltas toward zero", () => {
    const fine = { defence: 70, prosecution: 70 };
    expect(scaleDelta(2, fine)).toBe(2);
    expect(scaleDelta(2, { ...fine, defence: 39 })).toBe(1);
    expect(scaleDelta(1, { ...fine, defence: 39 })).toBe(0);
    expect(scaleDelta(-2, { ...fine, defence: 39 })).toBe(-2);
    expect(scaleDelta(-2, { ...fine, prosecution: 39 })).toBe(-1);
    expect(scaleDelta(-1, { ...fine, prosecution: 39 })).toBe(0);
    expect(scaleDelta(1, { ...fine, prosecution: 39 })).toBe(1);
  });

  it("clamps leans to ±10 and logs moves, and zero moves only when tags exist", () => {
    const jurors = { ...fresh().jurors, j1: { lean: 9, log: [] } };
    const upd = { jurors: ids.map((id) => ({ jurorId: id, delta: id === "j1" ? 2 : 0, reason: "r" })) };
    const out = applyJuryUpdate(jurors, upd, { defence: 70, prosecution: 70 }, "r5", []);
    expect(out.j1!.lean).toBe(10);
    expect(out.j1!.log[0]).toMatchObject({ rawDelta: 2, delta: 1, leanAfter: 10, entryId: "r5" });
    expect(out.j2!.log).toHaveLength(0);
    expect(jurors.j1.log).toHaveLength(0); // input untouched
    const tagged = applyJuryUpdate(jurors, upd, { defence: 70, prosecution: 70 }, "r5", [{ type: "question_withdrawn", by: "defence" }]);
    expect(tagged.j2!.log).toHaveLength(1);
  });

  it("computes the verdict by arithmetic", () => {
    const leans = (ls: number[]) => Object.fromEntries(ids.map((id, i) => [id, { lean: ls[i]!, log: [] }]));
    expect(computeVerdict(cf, leans([1, 1, 1, 1, 0])).outcome).toBe("not_guilty");
    expect(computeVerdict(cf, leans([0, 0, 0, 0, 5])).outcome).toBe("guilty");
    expect(computeVerdict(cf, leans([1, 1, 1, 0, 0])).outcome).toBe("hung");
    expect(computeVerdict(cf, leans([1, 0, 0, 0, 0])).votes.map((v) => v.vote)).toEqual(["not_guilty", "guilty", "guilty", "guilty", "guilty"]);
  });
});
