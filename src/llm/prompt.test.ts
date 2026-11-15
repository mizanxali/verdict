import { describe, expect, it } from "vitest";
import type { ActorRequest } from "../shared/contracts";
import type { RecordEntry } from "../shared/types";
import { buildMessages, buildPrompt, sharedPrefix, stripCacheControl } from "./prompt";
import { actorPrompt } from "./prompts/actors";
import type { RolePrompt } from "./prompts/role";
import {
  confrontPrompt,
  factCheckPrompt,
  juryPrompt,
  leakCheckPrompt,
  ruleCheckPrompt,
  rulingPrompt,
} from "./prompts/scorers";
import { miniCase, miniCtx, miniRecord, mossBrief, privateStrings } from "./miniCase";

const question: RecordEntry = {
  id: "r5",
  phase: "w1_cross",
  speaker: { kind: "player" },
  kind: "question",
  text: "The door log shows key 1 at 21:41. That is your key, isn't it?",
  exhibitIds: ["E1"],
  stricken: false,
  tags: [],
};
const answer: RecordEntry = { ...question, id: "r6", speaker: { kind: "witness", witnessId: "moss" }, kind: "answer", text: "I was home." };

function allRoles(): RolePrompt[] {
  const cf = miniCase;
  const reqs: ActorRequest[] = [
    { role: "witness", brief: mossBrief(), examiner: "defence", mode: "cross", question },
    { role: "prosecutor", task: "question", witnessId: "moss", mode: "direct", step: { topic: "locking up", exhibitIds: ["E2"] }, questionsLeft: 3 },
    { role: "prosecutor", task: "opening" },
    { role: "prosecutor", task: "closing" },
    { role: "judge", task: "ruling_line", ruling: { objection: "leading", sustained: true, ruleCited: "Leading", reason: "Suggests its answer on direct." }, objector: "defence" },
  ];
  const lie = cf.witnesses[0]!.lies[0]!;
  return [
    ...reqs.map((r) => actorPrompt(cf, r)),
    factCheckPrompt(cf, { speaker: "defence", entry: question, allowedExhibitIds: ["E1"] }),
    ruleCheckPrompt(cf, { speaker: "defence", entry: question, mode: "cross", witnessId: "moss" }),
    rulingPrompt(cf, { objector: "prosecution", ground: "badgering", entry: question, mode: "cross", witnessId: "moss" }),
    confrontPrompt(cf, { witnessId: "moss", lieId: lie.id, coverStory: lie.coverStory, mustConfront: lie.breakers[0]!.mustConfront, exhibitIds: ["E1"], entry: question }),
    juryPrompt(cf, {
      exchange: [question, answer],
      tags: [{ type: "lie_cracked", lieId: lie.id, witnessId: "moss", by: "defence", label: lie.label }],
      jurors: cf.jurors.map((j) => ({ id: j.id, name: j.name, persona: j.persona, disposition: j.disposition, lean: 0 })),
    }),
    leakCheckPrompt(cf, { witnessName: "Jory Moss", heldLies: [{ id: lie.id, coverStory: lie.coverStory, truth: lie.truth }], question, answer }),
  ];
}

const json = (v: unknown) => JSON.stringify(v);

describe("shared prefix", () => {
  it("is byte-identical across every role for the same context", () => {
    const ctx = miniCtx();
    const prefixes = allRoles().flatMap((role) =>
      [null, "low" as const].map((pme) => {
        const p = buildPrompt(ctx, role, { perMessageEffort: pme });
        return json({ system: p.system, first: p.messages[0] });
      }),
    );
    expect(prefixes.length).toBe(22);
    for (const p of prefixes) expect(p).toBe(prefixes[0]);
  });

  it("puts the role-specific part after the record, as a cue then a system message", () => {
    const role = allRoles()[0]!;
    const msgs = buildMessages(miniCtx(), role, { perMessageEffort: "low" });
    expect(msgs.map((m) => m.role)).toEqual(["user", "system", "user", "system"]);
    expect(msgs[1]).toEqual({ role: "system", content: [], output_config: { effort: "low" } });
    expect(json(msgs[3])).toContain(role.instructions.slice(0, 40));
    const scorer = buildMessages(miniCtx(), allRoles()[5]!, { perMessageEffort: null });
    expect(scorer.map((m) => m.role)).toEqual(["user", "user", "system"]);
  });

  it("uses at most 4 cache breakpoints, with one on the system prompt and one on the last record entry", () => {
    const long: RecordEntry[] = Array.from({ length: 40 }, (_, i) => ({ ...question, id: `r${i + 1}` }));
    for (const record of [[], miniRecord(), long]) {
      const p = buildPrompt(miniCtx(record), allRoles()[0]!, { perMessageEffort: "low" });
      const count = (json(p).match(/"cache_control"/g) ?? []).length;
      expect(count).toBeLessThanOrEqual(4);
      expect(p.system.at(-1)!.cache_control).toBeTruthy();
      const blocks = p.messages[0]!.content as { cache_control?: unknown }[];
      expect(blocks.at(-1)!.cache_control).toBeTruthy();
    }
    const blocks = buildPrompt(miniCtx(long), allRoles()[0]!, { perMessageEffort: null }).messages[0]!.content as { cache_control?: unknown }[];
    // header + 40 entries; breakpoints on entry 32 (index 32) and entry 40 (index 40)
    expect(blocks.map((b, i) => (b.cache_control ? i : -1)).filter((i) => i >= 0)).toEqual([32, 40]);
  });

  it("grows by appending blocks only: earlier record blocks are unchanged", () => {
    const base = miniRecord();
    const grown = [...base, question, answer];
    const a = stripCacheControl(sharedPrefix(miniCtx(base)));
    const b = stripCacheControl(sharedPrefix(miniCtx(grown)));
    expect(json(b.system)).toBe(json(a.system));
    const ab = a.record.content as unknown[];
    const bb = b.record.content as unknown[];
    expect(bb.length).toBe(ab.length + 2);
    expect(json(bb.slice(0, ab.length))).toBe(json(ab));
  });

  it("striking an entry does not rewrite its block; a note is added after the cached blocks", () => {
    const record = [...miniRecord(), question];
    const before = stripCacheControl(sharedPrefix(miniCtx(record))).record.content as { text: string }[];
    const struck = record.map((e) => (e.id === "r5" ? { ...e, stricken: true } : e));
    const after = stripCacheControl(sharedPrefix(miniCtx(struck))).record.content as { text: string }[];
    expect(json(after.slice(0, before.length))).toBe(json(before));
    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)!.text).toContain("r5");
  });

  it("contains no private case-file text", () => {
    const record = [...miniRecord(), question, answer];
    const text = json(sharedPrefix(miniCtx(record)));
    expect(text).not.toContain("PRIVATE-");
    for (const s of privateStrings()) expect(text).not.toContain(s);
    // Public fields are there.
    expect(text).toContain(miniCase.publicBrief);
    expect(text).toContain(miniCase.evidence[0]!.text);
    expect(text).toContain(miniCase.witnesses[1]!.publicStatement);
    expect(text).toContain(miniCase.jurors[0]!.persona);
  });

  it("renders deterministically", () => {
    expect(json(sharedPrefix(miniCtx()))).toBe(json(sharedPrefix(miniCtx())));
  });
});

describe("role prompts", () => {
  const lie = miniCase.witnesses[0]!.lies[0]!;

  it("a witness holding a lie gets the cover story and not the truth", () => {
    const role = actorPrompt(miniCase, { role: "witness", brief: mossBrief("held"), examiner: "defence", mode: "cross", question });
    const all = role.instructions + role.cue;
    expect(all).toContain(lie.coverStory);
    expect(all).not.toContain(lie.truth);
    expect(all).not.toContain(lie.concession);
    expect(all).not.toContain(lie.breakers[0]!.mustConfront);
    expect(role.cue).toContain(question.text);
    // Nothing about other witnesses or the timeline.
    expect(all).not.toContain(miniCase.timeline[0]!.event);
    expect(all).not.toContain(miniCase.witnesses[1]!.persona);
  });

  it("a witness whose lie just cracked is told to concede exactly the concession", () => {
    const role = actorPrompt(miniCase, { role: "witness", brief: mossBrief("justCracked"), examiner: "defence", mode: "cross", question });
    expect(role.instructions).toContain(lie.concession);
    expect(role.instructions).toContain("exactly this much and no more");
  });

  it("the prosecutor sees its own notes and the step, but no lies, dispositions or timeline", () => {
    const role = actorPrompt(miniCase, { role: "prosecutor", task: "question", witnessId: "moss", mode: "direct", step: { topic: "locking up", exhibitIds: ["E2"] }, questionsLeft: 2 });
    expect(role.instructions).toContain(miniCase.prosecution.theory);
    expect(role.instructions).toContain("Key register");
    expect(role.instructions).not.toContain(lie.truth);
    expect(role.instructions).not.toContain(lie.coverStory);
    expect(role.instructions).not.toContain(miniCase.jurors[0]!.disposition);
    expect(role.instructions).not.toContain(miniCase.timeline[0]!.event);
  });

  it("the jury scorer sees dispositions but no lie text or timeline", () => {
    const role = allRoles()[9]!;
    expect(role.call).toBe("scorer:jury");
    expect(role.instructions).toContain(miniCase.jurors[2]!.disposition);
    expect(role.instructions).toContain(lie.label);
    for (const s of [lie.truth, lie.coverStory, lie.concession, miniCase.timeline[0]!.event]) expect(role.instructions).not.toContain(s);
    expect(role.instructions).toContain("direction +"); // a prosecution witness lied: favours the defence
  });

  it("fact-check, rule-check and ruling prompts carry no private text", () => {
    for (const role of allRoles().slice(5, 8)) {
      for (const s of privateStrings()) expect(role.instructions + role.cue).not.toContain(s);
    }
  });
});
