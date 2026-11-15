import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCase } from "../cases/index";
import { createFakeLlm } from "../shared/fakeLlm";
import type { TrialState } from "../shared/types";
import { main as driverMain } from "./driver";
import { estimateTrial } from "./estimate";
import { main as regressMain } from "./regress";
import { runTrial } from "./runner";
import { loadScript, parseScript, scriptBudgets } from "./script";

const cf = loadCase();
const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err };
};

describe("driver", () => {
  it("plays a full fake trial to a verdict and saves the state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-"));
    const file = join(dir, "run.json");
    const c = capture();
    const code = await driverMain(["--fake", "--quiet", "--out", file], c.io);
    expect(code).toBe(0);
    const text = c.out.join("\n");
    expect(text).toContain("=== TRANSCRIPT ===");
    expect(text).toContain("VERDICT: NOT GUILTY");
    expect(text).toMatch(/lie_cracked\(renn_saw_face by defence\)/);
    expect(text).toContain("=== USAGE ===");
    expect(text).toMatch(/scorer:jury\s+\d+/);
    const state = JSON.parse(readFileSync(file, "utf8")) as TrialState;
    expect(state.phase).toBe("verdict");
    expect(state.verdict?.outcome).toBe("not_guilty");
    expect(Object.values(state.lieStatus).filter((s) => s === "cracked")).toHaveLength(4);
  });

  it("honours budget overrides", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-"));
    const file = join(dir, "run.json");
    const code = await driverMain(["--fake", "--quiet", "--script", "bluff", "--cross", "2", "--direct", "0", "--out", file], capture().io);
    expect(code).toBe(0);
    const state = JSON.parse(readFileSync(file, "utf8")) as TrialState;
    expect(state.budgets).toEqual({ directQuestions: 0, crossQuestions: 2, clientCrossQuestions: 1 });
    expect(state.record.filter((e) => e.phase === "w1_cross" && e.kind === "question")).toHaveLength(2);
  });

  it("without --fake and without a key, refuses to start", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const c = capture();
      expect(await driverMain(["--quiet"], c.io)).toBe(1);
      expect(c.err.join("\n")).toMatch(/ANTHROPIC_API_KEY is not set/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("runner edge cases", () => {
  const base = { name: "t", opening: { text: "Opening." }, closing: { text: "Closing." } };

  it("caps re-asks after refused witness turns and does not loop", async () => {
    const script = parseScript({
      ...base,
      maxReasks: 2,
      crosses: { renn: [{ text: "Where were you?", fakeMarkers: ["[refuse]"] }, { text: "Thank you. Anything else?" }] },
    });
    const res = await runTrial({ caseFile: cf, llm: createFakeLlm(), script, budgets: scriptBudgets(script, { direct: 0, client: 0 }), injectMarkers: true });
    expect(res.state.phase).toBe("verdict");
    expect(res.reasks).toBe(2);
    expect(res.abandoned).toEqual([{ witnessId: "renn", index: 0, text: "Where were you?" }]);
    const qs = res.state.record.filter((e) => e.phase === "w1_cross" && e.kind === "question");
    expect(qs).toHaveLength(4); // 1 ask + 2 re-asks, all struck, then the next question
    expect(qs.slice(0, 3).every((q) => q.stricken)).toBe(true);
  });

  it("skips a question the engine rejects and reports it", async () => {
    const script = parseScript({ ...base, crosses: { renn: [{ text: "Look at this.", exhibitIds: ["E99"] }, { text: "Fine." }] } });
    const res = await runTrial({ caseFile: cf, llm: createFakeLlm(), script, budgets: scriptBudgets(script, { direct: 0, client: 0 }), injectMarkers: true });
    expect(res.state.phase).toBe("verdict");
    expect(res.rejected).toEqual([expect.stringMatching(/^renn\[0\]: unknown exhibit E99/)]);
  });

  it("reports questions cut off by the budget", async () => {
    const script = loadScript("full-win", cf);
    const res = await runTrial({ caseFile: cf, llm: createFakeLlm(), script, budgets: scriptBudgets(script, { cross: 2 }), injectMarkers: true });
    expect(res.unasked.filter((u) => u.witnessId === "renn")).toHaveLength(4);
  });

  it.each(["full-win", "bluff", "invented", "real"])("the call estimate matches a fake run of %s", async (name) => {
    const script = loadScript(name, cf);
    const budgets = scriptBudgets(script);
    const res = await runTrial({ caseFile: cf, llm: createFakeLlm(), script, budgets, injectMarkers: true });
    const est = estimateTrial(script, cf, budgets);
    // The fake never refuses or retries; sustained objections skip the witness answer, so the estimate is an upper bound.
    expect(res.state.usage.length).toBeLessThanOrEqual(est.total);
    expect(res.state.usage.length).toBeGreaterThanOrEqual(est.total - 6);
    expect(res.state.juryCalls.length).toBe(est.juryCalls);
  });
});

describe("regress command", () => {
  it("passes end to end in fake mode and writes a report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "regress-"));
    const c = capture();
    expect(await regressMain(["--fake", "--runs", "2", "--out-dir", dir], c.io)).toBe(0);
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    expect(report.pass).toBe(true);
    expect(report.results.map((r: { name: string }) => r.name)).toEqual(["bluff", "invented", "real", "consistency"]);
    for (const t of ["bluff", "invented", "real"]) expect(JSON.parse(readFileSync(join(dir, `${t}.json`), "utf8")).phase).toBe("verdict");

    // --reuse re-checks the saved states without replaying trials.
    const dir2 = mkdtempSync(join(tmpdir(), "regress-"));
    expect(await regressMain(["--fake", "--reuse", dir, "--only", "real,bluff", "--out-dir", dir2], capture().io)).toBe(0);
  });

  it("does not start a real run without --yes", async () => {
    const c = capture();
    expect(await regressMain([], c.io)).toBe(2);
    expect(c.out.join("\n")).toMatch(/TOTAL: ~\d+ API calls/);
    expect(c.out.join("\n")).toMatch(/Re-run with --yes/);
  });
});
