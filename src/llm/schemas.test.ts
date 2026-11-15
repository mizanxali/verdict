import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import type { JuryUpdateRequest } from "../shared/contracts";
import { miniCase, miniCtx } from "./miniCase";
import { finishFactCheck, finishJuryUpdate, finishRuleCheck, finishRuling, WIRE } from "./schemas";

const ctx = miniCtx();
const entry = ctx.record[2]!;
const juryReq: JuryUpdateRequest = {
  exchange: ctx.record.slice(2),
  tags: [],
  jurors: miniCase.jurors.map((j) => ({ id: j.id, name: j.name, persona: j.persona, disposition: j.disposition, lean: 0 })),
};
const juror = (id: string, delta: number) => ({ jurorId: id, delta, reason: "x" });

describe("wire schemas", () => {
  it("send delta as an enforced enum, not unsupported min/max", () => {
    const schema = JSON.stringify(betaZodOutputFormat(WIRE.juryUpdate).schema);
    expect(schema).toContain('"enum":[-2,-1,0,1,2]');
    expect(schema).not.toMatch(/"minimum"|"maximum"/);
    for (const s of Object.values(WIRE)) {
      expect(JSON.stringify(betaZodOutputFormat(s).schema)).not.toMatch(/"minimum"|"maximum"|"minLength"|"maxLength"/);
    }
  });
});

describe("strict validation", () => {
  it("jury: one entry per juror, reordered to request order; anything else is invalid", () => {
    const ids = miniCase.jurors.map((j) => j.id);
    const ok = finishJuryUpdate({ jurors: [...ids].reverse().map((id) => juror(id, 1)) }, ctx, juryReq);
    expect(ok!.jurors.map((j) => j.jurorId)).toEqual(ids);
    expect(finishJuryUpdate({ jurors: ids.slice(1).map((id) => juror(id, 0)) }, ctx, juryReq)).toBeNull();
    expect(finishJuryUpdate({ jurors: ids.map((id) => juror(id, 3)) }, ctx, juryReq)).toBeNull();
    expect(finishJuryUpdate({ jurors: ids.map((id) => juror(id, 0.5)) }, ctx, juryReq)).toBeNull();
    expect(finishJuryUpdate({ jurors: [...ids.slice(0, 4), "j1"].map((id) => juror(id, 0)) }, ctx, juryReq)).toBeNull();
  });

  it("fact-check: refs must be admissible, otherwise a supported claim is unsupported", () => {
    const out = finishFactCheck(
      {
        claims: [
          { text: "a", verdict: "supported", refs: ["E2"], reason: "r" }, // E2 not allowed
          { text: "b", verdict: "supported", refs: ["E1", "r4", "r99"], reason: "r" },
          { text: "c", verdict: "unsupported", refs: ["E1"], reason: "r" },
        ],
      },
      ctx,
      { speaker: "defence", entry, allowedExhibitIds: ["E1"] },
    );
    expect(out!.claims.map((c) => [c.verdict, c.refs])).toEqual([
      ["unsupported", []],
      ["supported", ["E1", "r4"]],
      ["unsupported", []],
    ]);
  });

  it("rule-check drops leading on cross; ruling echoes the raised ground", () => {
    const rc = finishRuleCheck(
      { violations: [{ objection: "leading", severity: "clear", reason: "r" }, { objection: "badgering", severity: "arguable", reason: "r" }] },
      ctx,
      { speaker: "defence", entry, mode: "cross", witnessId: "moss" },
    );
    expect(rc!.violations.map((v) => v.objection)).toEqual(["badgering"]);
    const ruling = finishRuling({ objection: "hearsay", sustained: true, ruleCited: "x", reason: "y" }, ctx, {
      objector: "defence",
      ground: "speculation",
      entry,
      mode: "direct",
      witnessId: "moss",
    });
    expect(ruling!.objection).toBe("speculation");
    expect(finishRuling({ nope: 1 }, ctx, { objector: "defence", ground: "leading", entry, mode: "direct", witnessId: "moss" })).toBeNull();
  });
});
