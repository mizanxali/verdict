import { describe, expect, it } from "vitest";
import type { CaseFile } from "../shared/types";
import { CaseLoadError, loadCase, parseCase } from "./index";
import { validateCase } from "./validate";

const base = loadCase();
const clone = (): CaseFile => structuredClone(base);
const problemsAfter = (mutate: (c: CaseFile) => void): string[] => {
  const c = clone();
  mutate(c);
  return validateCase(c);
};

describe("loadCase", () => {
  it("loads the default calloway case", () => {
    expect(base.id).toBe("calloway");
    expect(base.defendantName).toBe("Iris Calloway");
    expect(base.witnesses.map((w) => w.id)).toEqual(["renn", "arden", "calloway"]);
    expect(base.jurors).toHaveLength(5);
    expect(base.evidence.length).toBeGreaterThanOrEqual(8);
    expect(base.evidence.length).toBeLessThanOrEqual(10);
    expect(loadCase("calloway")).toEqual(base);
  });

  it("passes cross-reference validation", () => {
    expect(validateCase(base)).toEqual([]);
  });

  it("gives Renn and Arden two lies each and Iris one", () => {
    expect(base.witnesses.map((w) => w.lies.length)).toEqual([2, 2, 1]);
  });

  it("keeps exhibits short enough to read quickly", () => {
    for (const e of base.evidence) {
      const words = e.text.split(/\s+/).filter(Boolean).length;
      // Tabular logs count every timestamp as words but scan quickly.
      const max = /log/.test(e.kind) ? 170 : 130;
      expect(words, e.id).toBeGreaterThanOrEqual(40);
      expect(words, e.id).toBeLessThanOrEqual(max);
    }
  });

  it("rejects an unknown case id with a readable error", () => {
    expect(() => loadCase("nope")).toThrow(CaseLoadError);
    expect(() => loadCase("nope")).toThrow(/No case file found/);
    expect(() => loadCase("../calloway")).toThrow(/not a valid case id/);
  });
});

describe("parseCase", () => {
  it("reports YAML syntax errors", () => {
    expect(() => parseCase("id: [unclosed", "bad.yaml")).toThrow(/bad\.yaml is invalid[\s\S]*YAML/);
  });

  it("lists every schema problem with its path", () => {
    try {
      parseCase("id: x\nplayerSide: prosecution\njurors: []\n", "schema.yaml");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CaseLoadError);
      const { problems, message } = e as CaseLoadError;
      expect(problems.length).toBeGreaterThan(3);
      expect(message).toMatch(/playerSide/);
      expect(message).toMatch(/jurors/);
      expect(message).toMatch(/title/);
    }
  });
});

describe("validateCase catches seeded errors", () => {
  it("duplicate ids", () => {
    const p = problemsAfter((c) => {
      c.evidence[1]!.id = "E1";
      c.jurors[1]!.id = "renn";
    });
    expect(p).toContainEqual(expect.stringMatching(/Duplicate id "E1"/));
    expect(p).toContainEqual(expect.stringMatching(/Duplicate id "renn"/));
  });

  it("duplicate lie ids across witnesses", () => {
    const p = problemsAfter((c) => {
      c.witnesses[2]!.lies[0]!.id = "renn_at_post";
    });
    expect(p).toContainEqual(expect.stringMatching(/Duplicate id "renn_at_post"/));
  });

  it("breaker pointing at a missing exhibit", () => {
    const p = problemsAfter((c) => {
      c.witnesses[0]!.lies[0]!.breakers[0]!.exhibitIds = ["E99"];
    });
    expect(p).toContainEqual(expect.stringMatching(/renn_saw_face.*"E99" does not exist/));
  });

  it("missing, unknown and short plan entries", () => {
    const p = problemsAfter((c) => {
      delete c.prosecution.plan.arden;
      c.prosecution.plan.ghost = [];
      c.prosecution.plan.renn = c.prosecution.plan.renn!.slice(0, 3);
      c.prosecution.plan.calloway = c.prosecution.plan.calloway!.slice(0, 5);
    });
    expect(p).toContainEqual(expect.stringMatching(/no entry for witness "arden"/));
    expect(p).toContainEqual(expect.stringMatching(/key "ghost"/));
    expect(p).toContainEqual(expect.stringMatching(/plan\.renn has 3 steps; it needs at least 4/));
    expect(p).toContainEqual(expect.stringMatching(/plan\.calloway has 5 steps; it needs at least 6/));
  });

  it("plan step with a missing exhibit", () => {
    const p = problemsAfter((c) => {
      c.prosecution.plan.renn![0]!.exhibitIds = ["E42"];
    });
    expect(p).toContainEqual(expect.stringMatching(/plan\.renn\[0\]: exhibit "E42"/));
  });

  it("defendant lie the prosecutor cannot crack", () => {
    const p = problemsAfter((c) => {
      for (const s of c.prosecution.plan.calloway!) s.exhibitIds = s.exhibitIds.filter((id) => id !== "E3");
    });
    expect(p).toContainEqual(expect.stringMatching(/calloway_at_home" cannot be cracked/));
  });

  it("wrong witness order or sides", () => {
    const p = problemsAfter((c) => {
      c.witnesses[1]!.calledBy = "defence";
      c.witnesses[2]!.calledBy = "prosecution";
      c.defendantName = "Someone Else";
    });
    expect(p).toContainEqual(expect.stringMatching(/witnesses\[1\].*prosecution/));
    expect(p).toContainEqual(expect.stringMatching(/witnesses\[2\].*defence/));
    expect(p).toContainEqual(expect.stringMatching(/defendantName/));
  });

  it("missing or duplicated objection rules", () => {
    const p = problemsAfter((c) => {
      c.rules.objections = c.rules.objections.filter((o) => o.type !== "hearsay");
      c.rules.objections.push({ ...c.rules.objections[0]! });
    });
    expect(p).toContainEqual(expect.stringMatching(/no rule for "hearsay"/));
    expect(p).toContainEqual(expect.stringMatching(/2 rules for "relevance"/));
  });

  it("wrong juror count", () => {
    const p = problemsAfter((c) => {
      c.jurors.pop();
    });
    expect(p).toContainEqual(expect.stringMatching(/4 jurors; there must be 5/));
  });

  it("unreachable or degenerate acquitAt", () => {
    const p = problemsAfter((c) => {
      c.jurors[0]!.acquitAt = -10;
      c.jurors[1]!.acquitAt = 11;
      c.jurors[2]!.startLean = 3;
      c.jurors[2]!.acquitAt = 3;
    });
    expect(p).toContainEqual(expect.stringMatching(/"osei".*never vote guilty/));
    expect(p).toContainEqual(expect.stringMatching(/"kapoor".*never acquit/));
    expect(p).toContainEqual(expect.stringMatching(/"lindqvist".*start out voting not guilty/));
  });

  it("timeline knownBy pointing at a non-witness", () => {
    const p = problemsAfter((c) => {
      c.timeline[0]!.knownBy = ["mbeki"];
    });
    expect(p).toContainEqual(expect.stringMatching(/knownBy "mbeki"/));
  });

  it("loadCase surfaces validator problems as one readable error", () => {
    const c = clone();
    c.witnesses[0]!.lies[0]!.breakers[0]!.exhibitIds = ["E99"];
    delete c.prosecution.plan.arden;
    expect(() => parseCase(JSON.stringify(c), "seeded.yaml")).toThrow(
      /seeded\.yaml is invalid \(2 problems\)[\s\S]*E99[\s\S]*no entry for witness "arden"/,
    );
  });
});
