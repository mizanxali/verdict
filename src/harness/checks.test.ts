import { beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "../cases/index";
import type { Llm } from "../shared/contracts";
import { createFakeLlm } from "../shared/fakeLlm";
import type { TrialState } from "../shared/types";
import { checkBluff, checkConsistency, checkInvented, checkReal, credibilityAt, replayJury } from "./checks";
import { runTrial } from "./runner";
import { loadScript, scriptBudgets } from "./script";

const cf = loadCase();
const runs: Record<string, TrialState> = {};

async function play(name: string): Promise<TrialState> {
  const script = loadScript(name, cf);
  const res = await runTrial({ caseFile: cf, llm: createFakeLlm(), script, budgets: scriptBudgets(script), injectMarkers: true });
  return res.state;
}

beforeAll(async () => {
  for (const n of ["bluff", "invented", "real"]) runs[n] = await play(n);
});

const copy = (s: TrialState) => structuredClone(s);

/** A fake whose leak grader reports every held lie abandoned. */
function leakyLlm(): Llm {
  const llm = createFakeLlm();
  llm.leakCheck = async (_ctx, req) => ({ leaks: req.heldLies.map((l) => ({ lieId: l.id, abandoned: true, quote: "I was outside" })) });
  return llm;
}

describe("bluff check", () => {
  it("passes on a fake bluff run", async () => {
    const r = await checkBluff(runs.bluff!, cf, createFakeLlm());
    expect(r.criteria.filter((c) => !c.ok)).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.usage.length).toBeGreaterThan(0); // leak grader was called
  });

  it("fails when a lie is cracked", async () => {
    const s = copy(runs.bluff!);
    s.lieStatus.renn_saw_face = "cracked";
    const r = await checkBluff(s, cf, createFakeLlm());
    expect(r.pass).toBe(false);
    expect(r.criteria[0]!.text).toMatch(/renn_saw_face/);
  });

  it("fails when an answer abandons a held lie in prose", async () => {
    const r = await checkBluff(runs.bluff!, cf, leakyLlm());
    expect(r.pass).toBe(false);
    expect(r.criteria.some((c) => !c.ok && /abandoned/.test(c.text))).toBe(true);
  });

  it("fails when the leak grader cannot score", async () => {
    const llm = createFakeLlm();
    llm.leakCheck = async () => null;
    expect((await checkBluff(runs.bluff!, cf, llm)).pass).toBe(false);
  });
});

describe("invented check", () => {
  const script = () => loadScript("invented", cf);

  it("passes on a fake invented run", async () => {
    const r = await checkInvented(runs.invented!, cf, script(), createFakeLlm());
    expect(r.criteria.filter((c) => !c.ok)).toEqual([]);
  });

  it("fails when the invented claims were not flagged", async () => {
    const s = copy(runs.invented!);
    for (const e of s.record) {
      e.tags = e.tags.filter((t) => t.type !== "claim_flagged");
      delete e.factCheck;
    }
    const r = await checkInvented(s, cf, script(), createFakeLlm());
    expect(r.pass).toBe(false);
    expect(r.criteria.find((c) => /fact-checker flagged/.test(c.text))!.ok).toBe(false);
  });

  it("fails when an objected invented question was not struck", async () => {
    const s = copy(runs.invented!);
    const q = s.record.find((e) => e.speaker.kind === "player" && e.kind === "question" && e.stricken)!;
    q.stricken = false;
    const r = await checkInvented(s, cf, script(), createFakeLlm());
    expect(r.criteria.find((c) => /prosecution objected/.test(c.text))!.ok).toBe(false);
  });

  it("fails when a juror moves toward the defence on a flagged exchange", async () => {
    const s = copy(runs.invented!);
    const change = s.jurors.hale!.log.find((c) => c.tags.some((t) => t.type === "claim_flagged"))!;
    change.delta = 1;
    const r = await checkInvented(s, cf, script(), createFakeLlm());
    expect(r.pass).toBe(false);
    expect(r.criteria.at(-1)!.text).toMatch(/hale@/);
  });

  it("fails when a lie cracked", async () => {
    const s = copy(runs.invented!);
    s.lieStatus.arden_only_code = "cracked";
    expect((await checkInvented(s, cf, script(), createFakeLlm())).pass).toBe(false);
  });
});

describe("real check", () => {
  it("passes on a fake real run", () => {
    const r = checkReal(runs.real!, cf);
    expect(r.criteria.filter((c) => !c.ok)).toEqual([]);
  });

  it("fails on a run that cracked nothing", () => {
    const r = checkReal(runs.bluff!, cf);
    expect(r.pass).toBe(false);
    expect(r.criteria.every((c) => !c.ok)).toBe(true);
  });

  it("fails when the jury did not move toward the defence on the cracks", () => {
    const s = copy(runs.real!);
    for (const j of Object.values(s.jurors)) for (const c of j.log) if (c.tags.some((t) => t.type === "lie_cracked")) c.delta = 0;
    const r = checkReal(s, cf);
    expect(r.pass).toBe(false);
    expect(r.criteria[2]!.ok).toBe(false);
  });

  it("fails when a crack has no defence tag", () => {
    const s = copy(runs.real!);
    for (const e of s.record) e.tags = e.tags.filter((t) => !(t.type === "lie_cracked" && t.lieId === "arden_left_nine"));
    expect(checkReal(s, cf).criteria[1]!.ok).toBe(false);
  });
});

describe("consistency check", () => {
  it("passes on a fake real run, with full delta agreement", async () => {
    const r = await checkConsistency(runs.real!, cf, createFakeLlm(), 3);
    expect(r.criteria.filter((c) => !c.ok)).toEqual([]);
    expect(r.data?.agreement).toBe(1);
    expect(r.data?.reconstructionExact).toBe(true);
    expect(r.usage).toHaveLength(3 * runs.real!.juryCalls.length);
  });

  it("fails when replays disagree", async () => {
    let n = 0;
    const llm = createFakeLlm();
    // Every other replay of each call swings every juror by +2, the rest by -2.
    llm.juryUpdate = async (_ctx, req) => ({ jurors: req.jurors.map((j) => ({ jurorId: j.id, delta: n++ % 2 ? 2 : -2, reason: "noise" })) });
    const r = await checkConsistency(runs.real!, cf, llm, 2);
    expect(r.pass).toBe(false);
    expect(r.data?.agreement).toBe(0);
  });

  it("rebuilds credibility from tags so stored results replay to the saved leans", () => {
    for (const s of Object.values(runs)) {
      const replay = replayJury(s, cf, s.juryCalls.map((c) => c.result));
      for (const j of cf.jurors) expect(replay.jurors[j.id]!.lean).toBe(s.jurors[j.id]!.lean);
      expect(replay.verdict).toEqual(s.verdict);
      expect(credibilityAt(s.record, s.record.length - 1)).toEqual(s.credibility);
    }
  });
});
