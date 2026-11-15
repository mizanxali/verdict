import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCase } from "../cases/index";
import { DEFAULT_BUDGETS } from "../shared/types";
import { itemText, loadScript, parseScript, policyFor, scriptBudgets, SCRIPTS_DIR, validateScript } from "./script";

const cf = loadCase();
const names = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const breakersOf = (wid: string) => new Set(cf.witnesses.find((w) => w.id === wid)!.lies.flatMap((l) => l.breakers.flatMap((b) => b.exhibitIds)));

describe("scripts", () => {
  it("ships the four scripts", () => {
    expect(names.sort()).toEqual(["bluff", "full-win", "invented", "real"]);
  });

  it.each(names)("%s parses and fits the case", (name) => {
    const s = loadScript(name, cf);
    expect(s.name).toBe(name);
    expect(validateScript(s, cf)).toEqual([]);
    expect(Object.keys(s.crosses).sort()).toEqual(["arden", "renn"]);
  });

  it("regression scripts encode small budgets", () => {
    for (const name of ["bluff", "invented", "real"]) {
      const b = scriptBudgets(loadScript(name, cf));
      expect(b.directQuestions).toBe(1);
      expect(b.clientCrossQuestions).toBe(1);
      expect(b.crossQuestions).toBeGreaterThanOrEqual(4);
      expect(b.crossQuestions).toBeLessThanOrEqual(6);
    }
    expect(scriptBudgets(loadScript("full-win", cf))).toEqual(DEFAULT_BUDGETS);
  });

  it("bluff never presents a breaker exhibit to the witness it would break", () => {
    const s = loadScript("bluff", cf);
    for (const [wid, qs] of Object.entries(s.crosses)) {
      const breakers = breakersOf(wid);
      for (const q of qs) for (const id of q.exhibitIds) expect(breakers.has(id), `${wid}: ${id}`).toBe(false);
      for (const q of qs) expect(q.fakeMarkers).not.toContain("[confront]");
    }
  });

  it("real and full-win present every prosecution breaker family", () => {
    for (const name of ["real", "full-win"]) {
      const s = loadScript(name, cf);
      for (const w of cf.witnesses.filter((x) => x.calledBy === "prosecution"))
        for (const lie of w.lies) {
          const shown = new Set(s.crosses[w.id]!.flatMap((q) => q.exhibitIds));
          expect(lie.breakers.some((b) => b.exhibitIds.every((id) => shown.has(id))), `${name}: ${lie.id}`).toBe(true);
        }
    }
  });

  it("invented marks invented claims in questions and the closing", () => {
    const s = loadScript("invented", cf);
    expect(s.closing.invented).toBe(true);
    for (const qs of Object.values(s.crosses)) expect(qs.filter((q) => q.invented).length).toBeGreaterThanOrEqual(2);
  });

  it("rejects bad scripts with every problem listed", () => {
    expect(() => parseScript({ name: "x" })).toThrow(/opening/);
    const s = parseScript({
      name: "x",
      opening: { text: "Hello [confront]" },
      closing: { text: "Bye" },
      crosses: { calloway: [{ text: "Q?", exhibitIds: ["E99"] }], nobody: [] },
    });
    const problems = validateScript(s, cf);
    expect(problems.join("\n")).toMatch(/opening: fake marker/);
    expect(problems.join("\n")).toMatch(/only cross-examines prosecution witnesses/);
    expect(problems.join("\n")).toMatch(/unknown exhibit E99/);
    expect(problems.join("\n")).toMatch(/nobody: no such witness/);
  });

  it("applies the objection policy and marker injection", () => {
    const s = loadScript("bluff", cf);
    expect(policyFor(s, "renn", 0)).toEqual({ action: "object", ground: "relevance" });
    expect(policyFor(s, "renn", 1)).toEqual({ action: "pass" });
    const q = s.crosses.renn![0]!;
    expect(itemText(q, false)).toBe(q.text);
    expect(itemText(q, true)).toBe(`${q.text} [violation:badgering]`);
    expect(scriptBudgets(s, { cross: 2 }).crossQuestions).toBe(2);
  });
});
