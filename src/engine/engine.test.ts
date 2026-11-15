import { describe, expect, it } from "vitest";
import { InvalidActionError, type ActorRequest, type Llm, type LlmContext } from "../shared/contracts";
import { createFakeLlm } from "../shared/fakeLlm";
import type { CaseFile, PlayerAction, RecordEntry, TrialEvent, TrialState } from "../shared/types";
import { fixtureCase, SECRET_MARKERS } from "./fixture";
import { createTrial, toPlayerView } from "./index";
import { NOTICE_REPHRASE } from "./engine";

// ───────────────────────── Helpers ─────────────────────────

/** Wraps an Llm, keeping onUsage wired to the inner instance (the fake calls its own onUsage). */
function wrap(inner: Llm, over: Partial<Omit<Llm, "onUsage">>): Llm {
  return {
    actor: (...a) => inner.actor(...a),
    factCheck: (...a) => inner.factCheck(...a),
    ruleCheck: (...a) => inner.ruleCheck(...a),
    ruling: (...a) => inner.ruling(...a),
    confront: (...a) => inner.confront(...a),
    juryUpdate: (...a) => inner.juryUpdate(...a),
    leakCheck: (...a) => inner.leakCheck(...a),
    ...over,
    get onUsage() {
      return inner.onUsage;
    },
    set onUsage(f) {
      inner.onUsage = f;
    },
  };
}

function setup(opts: { llm?: Llm; caseFile?: CaseFile; state?: TrialState } = {}) {
  const events: TrialEvent[] = [];
  const caseFile = opts.caseFile ?? fixtureCase();
  const engine = createTrial({ caseFile, llm: opts.llm ?? createFakeLlm(), emit: (e) => events.push(e), state: opts.state });
  const act = (a: PlayerAction) => engine.act(a);
  return { engine, events, caseFile, act };
}

type T = ReturnType<typeof setup>;

const last = (s: TrialState) => s.record[s.record.length - 1]!;
const byKind = (s: TrialState, kind: RecordEntry["kind"]) => s.record.filter((e) => e.kind === kind);
const ask = (text: string, exhibitIds: string[] = []): PlayerAction => ({ type: "ask", text, exhibitIds });

async function toW1Cross(t: T) {
  await t.act({ type: "begin" });
  await t.act({ type: "opening", text: "My client is innocent." });
  await t.act({ type: "pass" });
  await t.act({ type: "pass" });
  expect(t.engine.state.phase).toBe("w1_cross");
}

async function toW3Cross(t: T) {
  await toW1Cross(t);
  await t.act({ type: "end_cross" });
  await t.act({ type: "pass" });
  await t.act({ type: "end_cross" });
  expect(t.engine.state.phase).toBe("w3_cross");
}

// ───────────────────────── Flow ─────────────────────────

describe("full trial", () => {
  it("runs from begin to verdict", async () => {
    const t = setup();
    const s = t.engine.state;
    expect(s.phase).toBe("case_review");
    expect(s.pending).toBe("begin");

    await t.act({ type: "begin" });
    expect(s.phase).toBe("opening");
    expect(s.pending).toBe("opening");
    expect(s.record[0]).toMatchObject({ speaker: { kind: "prosecutor" }, kind: "statement" });

    await t.act({ type: "opening", text: "My client is innocent." });
    expect(s.phase).toBe("w1_direct");
    expect(s.pending).toBe("objection_window");
    expect(s.witnessId).toBe("renn");
    expect(s.record.some((e) => e.kind === "narration" && e.text.includes("The prosecution calls Ada Renn"))).toBe(true);
    // the engine attached the plan step's exhibit
    expect(last(s)).toMatchObject({ kind: "question", exhibitIds: ["E1"] });
    expect(last(s).tags).toContainEqual({ type: "exhibit_admitted", by: "prosecution", exhibitId: "E1" });
    expect(s.admitted).toEqual(["E1"]);
    expect(s.shown.renn).toEqual(["E1"]);

    await t.act({ type: "pass" });
    expect(last(s).kind).toBe("question");
    await t.act({ type: "pass" });
    expect(s.phase).toBe("w1_cross");
    expect(s.pending).toBe("question");
    expect(s.questionsLeft).toBe(8);
    expect(last(s)).toMatchObject({ kind: "narration", text: "Your witness." });

    await t.act(ask("Did you lock the safe?"));
    expect(last(s)).toMatchObject({ kind: "answer", speaker: { kind: "witness", witnessId: "renn" } });
    expect(s.questionsLeft).toBe(7);
    await t.act({ type: "end_cross" });

    expect(s.phase).toBe("w2_direct");
    expect(s.witnessId).toBe("okafor");
    await t.act({ type: "pass" });
    expect(s.phase).toBe("w2_cross");
    await t.act({ type: "end_cross" });

    expect(s.phase).toBe("w3_cross");
    expect(s.witnessId).toBe("vance");
    await t.act({ type: "pass" });
    await t.act({ type: "pass" });

    expect(s.phase).toBe("closing");
    expect(s.pending).toBe("closing");
    expect(s.witnessId).toBeNull();
    expect(last(s)).toMatchObject({ speaker: { kind: "prosecutor" }, kind: "statement" });

    await t.act({ type: "closing", text: "Reasonable doubt abounds." });
    expect(s.phase).toBe("verdict");
    expect(s.pending).toBeNull();
    expect(s.verdict).not.toBeNull();
    expect(s.endedAt).not.toBeNull();

    // ids in order, every entry streamed start → end
    expect(s.record.map((e) => e.id)).toEqual(s.record.map((_, i) => `r${i + 1}`));
    for (const e of s.record) {
      const start = t.events.findIndex((ev) => ev.type === "entry_start" && ev.entryId === e.id);
      const end = t.events.findIndex((ev) => ev.type === "entry_end" && ev.entry.id === e.id);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
    }
    expect(t.events.some((e) => e.type === "token")).toBe(true);
    expect(t.events.filter((e) => e.type === "error")).toEqual([]);

    // the prosecutor cracked the defendant (fake jury: -2 each), all else neutral → guilty
    expect(s.verdict!.outcome).toBe("guilty");
    expect(s.verdict!.votes.every((v) => v.finalLean === -2)).toBe(true);
    // one jury call per exchange: 2 openings, 2+1+2 prosecutor questions, 1 cross question, 2 closings
    expect(s.juryCalls).toHaveLength(10);
    expect(s.usage.length).toBeGreaterThan(0);

    const v = t.engine.view();
    expect(v.result?.verdict.outcome).toBe("guilty");
    expect(v.result?.replay).toHaveLength(5);
    expect(v.usage.calls).toBe(s.usage.length);
    await expect(t.act({ type: "begin" })).rejects.toBeInstanceOf(InvalidActionError);
  });
});

// ───────────────────────── Lie-cracking ─────────────────────────

describe("lie-cracking", () => {
  it("cracks only with the right exhibit AND a real confrontation", async () => {
    const t = setup();
    await toW1Cross(t);
    const s = t.engine.state;

    await t.act(ask("Where were you at nine? [confront]", ["E2"]));
    expect(s.lieStatus.L1).toBe("cracked");
    const answer = last(s);
    expect(answer.kind).toBe("answer");
    expect(answer.text).toContain("CONCESSION_L1");
    expect(answer.tags).toContainEqual({ type: "lie_cracked", lieId: "L1", witnessId: "renn", by: "defence", label: "LABEL_L1 Renn was at the docks" });
    expect(t.engine.view().exposedLies).toEqual([{ lieId: "L1", witnessId: "renn", label: "LABEL_L1 Renn was at the docks" }]);

    await t.engine.idle();
    expect(Object.values(s.jurors).every((j) => j.lean === 2)).toBe(true);
    expect(s.jurors.j1!.log.at(-1)).toMatchObject({ rawDelta: 2, delta: 2, leanAfter: 2, entryId: answer.id });
  });

  it("a bluff ([confront] without the exhibit) does not crack", async () => {
    const t = setup();
    await toW1Cross(t);
    await t.act(ask("You were at the docks, weren't you? [confront]"));
    expect(t.engine.state.lieStatus.L1).toBe("held");
    expect(last(t.engine.state).text).not.toContain("CONCESSION");
    expect(t.engine.view().exposedLies).toEqual([]);
  });

  it("the exhibit without a real confrontation does not crack", async () => {
    const t = setup();
    await toW1Cross(t);
    await t.act(ask("Please look at this footage.", ["E2"]));
    expect(t.engine.state.lieStatus.L1).toBe("held");
    // E2 is now shown, but a later confrontation must attach a breaker exhibit again
    await t.act(ask("So you were at the docks? [confront]"));
    expect(t.engine.state.lieStatus.L1).toBe("held");
    await t.act(ask("So you were at the docks? [confront]", ["E2"]));
    expect(t.engine.state.lieStatus.L1).toBe("cracked");
  });

  it("a multi-exhibit breaker needs every exhibit shown to this witness", async () => {
    const t = setup();
    await toW1Cross(t); // E1 was shown to renn, not okafor
    await t.act({ type: "end_cross" });
    await t.act({ type: "pass" });
    expect(t.engine.state.phase).toBe("w2_cross");
    await t.act(ask("The lab report? [confront]", ["E4"]));
    expect(t.engine.state.lieStatus.L2).toBe("held");
    await t.act(ask("And the log? [confront]", ["E1"]));
    expect(t.engine.state.lieStatus.L2).toBe("cracked");
  });

  it("the prosecutor can crack the defendant's lie with a plan exhibit", async () => {
    const t = setup();
    await toW3Cross(t);
    const s = t.engine.state;
    await t.act({ type: "pass" });
    expect(s.lieStatus.L3).toBe("held");
    await t.act({ type: "pass" });
    expect(s.lieStatus.L3).toBe("cracked");
    const answer = byKind(s, "answer").at(-1)!;
    expect(answer.tags).toContainEqual(expect.objectContaining({ type: "lie_cracked", lieId: "L3", by: "prosecution" }));
    expect(s.shown.vance).toEqual(["E3"]);
    expect(s.phase).toBe("closing");
  });

  it("a sustained defence objection stops the prosecutor's crack", async () => {
    const cf = fixtureCase();
    cf.prosecution.plan.vance![1]!.topic = "[confront] [violation:leading] the fuel receipt";
    const t = setup({ caseFile: cf });
    await toW3Cross(t);
    await t.act({ type: "pass" });
    await t.act({ type: "object", ground: "leading" });
    expect(t.engine.state.lieStatus.L3).toBe("held");
  });

  it("a held lie's truth never reaches any actor", async () => {
    const seen: { ctx: LlmContext; req: ActorRequest }[] = [];
    const inner = createFakeLlm();
    const llm = wrap(inner, {
      actor: (ctx, req, onToken, signal) => {
        seen.push(structuredClone({ ctx, req }));
        return inner.actor(ctx, req, onToken, signal);
      },
    });
    const t = setup({ llm });
    await toW1Cross(t);
    await t.act(ask("Look at E2. [confront]", ["E2"])); // cracks L1
    await t.act(ask("Anything else?"));
    await t.act({ type: "end_cross" });
    await t.act({ type: "pass" });
    await t.act(ask("Did you test for prints? [confront]")); // bluff on L2
    await t.act({ type: "end_cross" });
    await t.act({ type: "pass" });
    await t.act({ type: "pass" }); // prosecutor cracks L3
    await t.act({ type: "closing", text: "Acquit." });

    const cf = t.caseFile;
    const truthOf = new Map(cf.witnesses.flatMap((w) => w.lies.map((l) => [l.id, l] as const)));
    let checkedHeld = 0;
    for (const { ctx, req } of seen) {
      const crackedHere = new Set(req.role === "witness" ? req.brief.lies.filter((l) => l.status === "cracked").map((l) => l.id) : []);
      for (const [id, lie] of truthOf) {
        if (crackedHere.has(id)) continue;
        expect(JSON.stringify(req)).not.toContain(lie.truth);
        expect(JSON.stringify(req)).not.toContain(lie.concession);
        expect(JSON.stringify(ctx.record)).not.toContain(lie.truth);
      }
      if (req.role === "witness")
        for (const l of req.brief.lies)
          if (l.status === "held") {
            checkedHeld++;
            expect(l.truth).toBeUndefined();
            expect(l.concession).toBeUndefined();
            expect(Object.keys(l).sort()).toEqual(["coverStory", "id", "justCracked", "status", "topic"]);
          }
    }
    // renn ×2 on direct, okafor on direct + the bluff, vance's first answer
    expect(checkedHeld).toBe(5);
    // L2 was never cracked: its truth appears nowhere at all
    // (ctx.caseFile carries the whole file by contract; keeping it out of prompts is the llm layer's job)
    expect(JSON.stringify(seen.map(({ ctx, req }) => [ctx.record, req]))).not.toMatch(/TRUTH_L2|CONCESSION_L2/);
  });
});

// ───────────────────────── Gate and objections ─────────────────────────

describe("gate on player questions", () => {
  it("an invented fact draws a sustained objection and no answer", async () => {
    const t = setup();
    await toW1Cross(t);
    const s = t.engine.state;
    const before = s.record.length;
    t.events.length = 0;

    await t.act(ask("After you fled the scene [unsupported], where did you go?"));
    const added = s.record.slice(before);
    expect(added.map((e) => [e.speaker.kind, e.kind])).toEqual([
      ["player", "question"],
      ["prosecutor", "objection"],
      ["judge", "ruling"],
    ]);
    expect(added[0]!.stricken).toBe(true);
    expect(added[0]!.tags).toContainEqual(expect.objectContaining({ type: "claim_flagged", by: "defence", verdict: "unsupported" }));
    expect(added[1]!.text).toMatch(/assumes facts/i);
    expect(added[2]!.tags).toContainEqual({ type: "objection_sustained", by: "prosecution", ground: "assumes_facts" });
    expect(s.credibility).toEqual({ defence: 70 - 6 - 5, prosecution: 70 });
    expect(s.questionsLeft).toBe(7); // a struck question still costs one
    expect(s.pending).toBe("question");
    // nothing of the speculative answer reached the player
    expect(t.events.some((e) => e.type === "entry_start" && e.speaker.kind === "witness")).toBe(false);
    expect(t.events.some((e) => e.type === "entry_discard")).toBe(false);
  });

  it("a clear rule violation draws an objection on that ground", async () => {
    const t = setup();
    await toW1Cross(t);
    await t.act(ask("Tell me what he was thinking [violation:speculation]"));
    const s = t.engine.state;
    expect(byKind(s, "ruling").at(-1)!.tags).toContainEqual({ type: "objection_sustained", by: "prosecution", ground: "speculation" });
    expect(s.credibility.defence).toBe(65);
    expect(last(s).kind).toBe("ruling");
  });

  it("an overruled prosecution objection costs the prosecution and the answer proceeds", async () => {
    const inner = createFakeLlm();
    const llm = wrap(inner, { ruling: async (_c, r) => ({ objection: r.ground, sustained: false, ruleCited: "x", reason: "x" }) });
    const t = setup({ llm });
    await toW1Cross(t);
    await t.act(ask("You hid the money [contradicted]?"));
    const s = t.engine.state;
    expect(s.credibility).toEqual({ defence: 60, prosecution: 62 });
    expect(last(s).kind).toBe("answer");
    expect(byKind(s, "ruling").at(-1)!.tags).toContainEqual({ type: "objection_overruled", by: "prosecution", ground: "assumes_facts" });
  });

  it("speculates the answer while the gate runs, but buffers it", async () => {
    const log: string[] = [];
    const inner = createFakeLlm();
    const llm = wrap(inner, {
      factCheck: async (c, r) => {
        await new Promise((res) => setTimeout(res, 20));
        log.push("factcheck:done");
        return inner.factCheck(c, r);
      },
      actor: (c, r, onToken, sig) => {
        if (r.role === "witness") log.push("witness:start");
        return inner.actor(c, r, onToken, sig);
      },
    });
    const events: TrialEvent[] = [];
    const engine = createTrial({ caseFile: fixtureCase(), llm, emit: (e) => events.push(e) });
    await engine.act({ type: "begin" });
    await engine.act({ type: "opening", text: "Innocent." });
    await engine.act({ type: "pass" });
    await engine.act({ type: "pass" });
    log.length = 0;
    const origPush = events.push.bind(events);
    events.push = (...e: TrialEvent[]) => {
      for (const ev of e) if (ev.type === "entry_start" && ev.speaker.kind === "witness") log.push("witness:visible");
      return origPush(...e);
    };
    await engine.act(ask("Did you lock up?"));
    expect(log).toEqual(["witness:start", "factcheck:done", "witness:visible"]);
  });

  it("aborts the speculative answer when the objection is sustained", async () => {
    const signals: AbortSignal[] = [];
    const inner = createFakeLlm({ tokenDelayMs: 5 });
    const llm = wrap(inner, {
      actor: (c, r, onToken, sig) => {
        if (r.role === "witness" && sig) signals.push(sig);
        return inner.actor(c, r, onToken, sig);
      },
    });
    const t = setup({ llm });
    await toW1Cross(t);
    await t.act(ask("Since you stole it [unsupported]?"));
    expect(signals.at(-1)?.aborted).toBe(true);
    expect(last(t.engine.state).kind).toBe("ruling");
  });
});

describe("player objections in the prosecutor loop", () => {
  it("a bad objection is overruled, costs credibility, and the witness answers", async () => {
    const t = setup();
    await t.act({ type: "begin" });
    await t.act({ type: "opening", text: "Innocent." });
    await t.act({ type: "object", ground: "hearsay" });
    const s = t.engine.state;
    expect(s.credibility).toEqual({ defence: 62, prosecution: 70 });
    const kinds = s.record.slice(-4).map((e) => e.kind);
    expect(kinds).toEqual(["objection", "ruling", "answer", "question"]); // then the next question
    expect(byKind(s, "ruling")[0]!.tags).toContainEqual({ type: "objection_overruled", by: "defence", ground: "hearsay" });
    expect(s.pending).toBe("objection_window");
  });

  it("a good objection strikes the question with no answer", async () => {
    const cf = fixtureCase();
    cf.prosecution.plan.renn![0]!.topic = "[violation:leading] locking the safe";
    const t = setup({ caseFile: cf });
    await t.act({ type: "begin" });
    await t.act({ type: "opening", text: "Innocent." });
    const q = last(t.engine.state);
    await t.act({ type: "object", ground: "leading" });
    const s = t.engine.state;
    expect(q.stricken).toBe(true);
    expect(s.credibility).toEqual({ defence: 70, prosecution: 65 });
    const ruling = byKind(s, "ruling")[0]!;
    expect(ruling.tags).toEqual([
      { type: "objection_sustained", by: "defence", ground: "leading" },
      { type: "question_withdrawn", by: "prosecution" },
    ]);
    expect(byKind(s, "answer")).toHaveLength(0);
  });

  it("a null ruling is 'I'll allow it' with no credibility change", async () => {
    const llm = wrap(createFakeLlm(), { ruling: async () => null });
    const t = setup({ llm });
    await t.act({ type: "begin" });
    await t.act({ type: "opening", text: "Innocent." });
    await t.act({ type: "object", ground: "relevance" });
    const s = t.engine.state;
    expect(byKind(s, "ruling")[0]).toMatchObject({ text: "I'll allow it.", tags: [] });
    expect(s.credibility).toEqual({ defence: 70, prosecution: 70 });
    expect(byKind(s, "answer")).toHaveLength(1);
  });

  it("a flagged prosecutor claim is tagged and costs the prosecution", async () => {
    const cf = fixtureCase();
    cf.prosecution.plan.renn![0]!.topic = "[unsupported] the stolen van";
    const t = setup({ caseFile: cf });
    await t.act({ type: "begin" });
    await t.act({ type: "opening", text: "Innocent." });
    const q = last(t.engine.state);
    await t.act({ type: "pass" });
    expect(q.tags).toContainEqual(expect.objectContaining({ type: "claim_flagged", by: "prosecution", verdict: "unsupported" }));
    expect(t.engine.state.credibility.prosecution).toBe(64);
    await t.engine.idle();
    const call = t.engine.state.juryCalls.find((c) => c.exchangeEntryIds.includes(q.id))!;
    expect(call.tags).toContainEqual(expect.objectContaining({ type: "claim_flagged", by: "prosecution" }));
  });
});

// ───────────────────────── Refusals and failures ─────────────────────────

describe("refusals and failures", () => {
  it("a refused witness turn strikes the question and does not spend budget", async () => {
    const t = setup();
    await toW1Cross(t);
    const s = t.engine.state;
    const before = s.record.length;
    const callsBefore = (await t.engine.idle(), s.juryCalls.length);
    t.events.length = 0;
    await t.act(ask("[refuse] Where were you?"));
    expect(s.questionsLeft).toBe(8);
    expect(s.record.length).toBe(before + 1);
    expect(last(s)).toMatchObject({ kind: "question", stricken: true, tags: [] });
    expect(t.events).toContainEqual({ type: "notice", text: NOTICE_REPHRASE });
    expect(s.pending).toBe("question");
    await t.engine.idle();
    expect(s.juryCalls.length).toBe(callsBefore);
    expect(s.credibility).toEqual({ defence: 70, prosecution: 70 });
  });

  it("a refusing prosecutor is retried once, then replaced by a code-written line", async () => {
    let prosecutorCalls = 0;
    const inner = createFakeLlm();
    const llm = wrap(inner, {
      actor: async (c, r, onToken, sig) => {
        if (r.role === "prosecutor") {
          prosecutorCalls++;
          return { text: "", refused: true };
        }
        return inner.actor(c, r, onToken, sig);
      },
    });
    const t = setup({ llm });
    await t.act({ type: "begin" });
    expect(prosecutorCalls).toBe(2);
    expect(t.engine.state.record[0]!.text).toContain("The payroll vanished.");
    expect(t.events.filter((e) => e.type === "entry_discard")).toHaveLength(2);
    await t.act({ type: "opening", text: "Innocent." });
    expect(last(t.engine.state).text).toBe("Please tell the court about locking the safe.");
    expect(t.engine.state.pending).toBe("objection_window");
  });

  it("a thrown llm error surfaces as an error event and changes nothing", async () => {
    const llm = wrap(createFakeLlm(), {
      factCheck: async () => {
        throw new Error("boom");
      },
    });
    const t = setup({ llm });
    await toW1Cross(t);
    await t.act(ask("Where were you [unsupported]?"));
    expect(t.events.some((e) => e.type === "error" && e.message.includes("boom"))).toBe(true);
    expect(last(t.engine.state).kind).toBe("answer");
    expect(t.engine.state.credibility.defence).toBe(70);
  });

  it("an invalid jury update is logged as null and moves no one", async () => {
    const llm = wrap(createFakeLlm(), {
      juryUpdate: async () => ({ jurors: [{ jurorId: "j1", delta: 2, reason: "only one" }] }),
    });
    const t = setup({ llm });
    await toW1Cross(t);
    await t.act(ask("[confront] the docks", ["E2"]));
    await t.engine.idle();
    const s = t.engine.state;
    expect(s.juryCalls.length).toBeGreaterThan(0);
    expect(s.juryCalls.every((c) => c.result === null)).toBe(true);
    expect(Object.values(s.jurors).every((j) => j.lean === 0 && j.log.length === 0)).toBe(true);
  });

  it("jury updates run in exchange order without blocking the player", async () => {
    const order: string[] = [];
    const inner = createFakeLlm();
    const llm = wrap(inner, {
      juryUpdate: async (c, r) => {
        await new Promise((res) => setTimeout(res, 15));
        order.push(r.exchange.at(-1)!.id);
        return inner.juryUpdate(c, r);
      },
    });
    const t = setup({ llm });
    await t.act({ type: "begin" });
    await t.act({ type: "opening", text: "Innocent." });
    expect(t.engine.state.juryCalls).toHaveLength(0); // still in the background
    await t.engine.idle();
    expect(t.engine.state.juryCalls.map((c) => c.uptoEntryId)).toEqual(order);
    expect(order).toEqual(["r1", "r2"]);
  });
});

// ───────────────────────── Invalid actions ─────────────────────────

describe("invalid actions", () => {
  it("are rejected without mutating state", async () => {
    const t = setup();
    const snap = () => structuredClone(t.engine.state);
    let before = snap();
    for (const a of [{ type: "ask", text: "Q", exhibitIds: [] }, { type: "pass" }, { type: "closing", text: "x" }] as PlayerAction[]) {
      await expect(t.act(a)).rejects.toBeInstanceOf(InvalidActionError);
      expect(t.engine.state).toEqual(before);
    }
    await toW1Cross(t);
    before = snap();
    const bad: unknown[] = [
      { type: "ask", text: "Look", exhibitIds: ["E99"] },
      { type: "ask", text: "   ", exhibitIds: [] },
      { type: "ask", text: "Look" },
      { type: "object", ground: "hearsay" },
      { type: "begin" },
      null,
      { nope: 1 },
    ];
    for (const a of bad) {
      await expect(t.act(a as PlayerAction)).rejects.toBeInstanceOf(InvalidActionError);
      expect(t.engine.state).toEqual(before);
    }
  });

  it("rejects a second act while one is running", async () => {
    const t = setup({ llm: createFakeLlm({ tokenDelayMs: 2 }) });
    const first = t.act({ type: "begin" });
    await expect(t.act({ type: "begin" })).rejects.toBeInstanceOf(InvalidActionError);
    await first;
    expect(t.engine.state.pending).toBe("opening");
  });
});

// ───────────────────────── View redaction ─────────────────────────

describe("toPlayerView", () => {
  it("never leaks private fields before the verdict", async () => {
    const t = setup();
    await toW1Cross(t);
    await t.act(ask("Did you lock up [unsupported]?"));
    await t.act(ask("Plain question?"));
    await t.engine.idle();
    const s = t.engine.state;
    const v = t.engine.view();
    const json = JSON.stringify(v);
    for (const m of SECRET_MARKERS) expect(json).not.toContain(m);
    expect(json).not.toContain("lieStatus");
    expect(json).not.toContain("juryCalls");
    expect(json).not.toContain("lean");
    expect(json).not.toContain("acquitAt");
    expect(json).not.toContain("coverStory");
    expect(v.result).toBeNull();
    expect(Object.keys(v.caseInfo.jurors[0]!).sort()).toEqual(["id", "name", "persona"]);
    expect(Object.keys(v.caseInfo.witnesses[0]!).sort()).toEqual(["calledBy", "id", "name", "publicStatement", "role"]);

    // factCheck kept only on the player's own entries
    expect(s.record[0]!.factCheck).toBeDefined(); // prosecutor opening, checked in state
    expect(v.record[0]!.factCheck).toBeUndefined();
    const own = v.record.filter((e) => e.speaker.kind === "player" && e.kind !== "objection");
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((e) => e.factCheck)).toBe(true);
    expect(v.record.filter((e) => e.speaker.kind !== "player").every((e) => e.factCheck === undefined)).toBe(true);

    // everything ever pushed to the browser is clean too
    const stream = JSON.stringify(t.events);
    for (const m of SECRET_MARKERS) expect(stream).not.toContain(m);
    for (const e of t.events) if (e.type === "entry_end" && e.entry.speaker.kind !== "player") expect(e.entry.factCheck).toBeUndefined();

    // the view is a copy
    v.record[0]!.text = "tampered";
    expect(s.record[0]!.text).not.toBe("tampered");
  });

  it("shows exposed lies by label, and the result only at the verdict", async () => {
    const t = setup();
    await toW1Cross(t);
    await t.act(ask("[confront]", ["E2"]));
    const v = toPlayerView(t.engine.state, t.caseFile);
    expect(v.exposedLies).toEqual([{ lieId: "L1", witnessId: "renn", label: "LABEL_L1 Renn was at the docks" }]);
    expect(JSON.stringify(v)).not.toContain("TRUTH_");
    expect(JSON.stringify(v)).not.toContain("LABEL_L2");

    const ended: TrialState = { ...structuredClone(t.engine.state), phase: "verdict", pending: null, verdict: { outcome: "hung", votes: [] } };
    const fin = toPlayerView(ended, t.caseFile);
    expect(fin.result?.verdict.outcome).toBe("hung");
    expect(fin.result?.replay[0]).toMatchObject({ jurorId: "j1", startLean: 0, acquitAt: 1 });
    expect(JSON.stringify(fin)).not.toContain("DISPOSITION_SECRET");
  });
});

// ───────────────────────── Resume ─────────────────────────

describe("resume", () => {
  it("continues a saved trial from the objection window", async () => {
    const a = setup();
    await a.act({ type: "begin" });
    await a.act({ type: "opening", text: "Innocent." });
    await a.engine.idle();
    const saved = structuredClone(a.engine.state);

    const b = setup({ state: saved });
    expect(b.engine.state).not.toBe(saved);
    expect(b.engine.state).toEqual(saved);
    await b.act({ type: "pass" });
    await b.act({ type: "pass" });
    expect(b.engine.state.phase).toBe("w1_cross");
    expect(saved.phase).toBe("w1_direct"); // deep-copied
    expect(b.engine.state.usage.length).toBeGreaterThan(saved.usage.length); // onUsage wired
  });

  it("refuses to resume a state mid-action", () => {
    const s = setup().engine.state;
    expect(() => setup({ state: { ...structuredClone(s), pending: null } })).toThrow();
  });

  it("honours budgets", async () => {
    const events: TrialEvent[] = [];
    const engine = createTrial({ caseFile: fixtureCase(), llm: createFakeLlm(), emit: (e) => events.push(e), budgets: { directQuestions: 1, crossQuestions: 1 } });
    await engine.act({ type: "begin" });
    await engine.act({ type: "opening", text: "Innocent." });
    await engine.act({ type: "pass" });
    expect(engine.state.phase).toBe("w1_cross");
    expect(engine.state.questionsLeft).toBe(1);
    await engine.act(ask("One?"));
    expect(engine.state.phase).toBe("w2_direct");
  });
});

describe("concession", () => {
  it("tags a defence statement that gives the case away and moves every juror against the defence", async () => {
    const events: TrialEvent[] = [];
    const cf = fixtureCase();
    const engine = createTrial({ caseFile: cf, llm: createFakeLlm(), emit: (e) => events.push(e) });
    await engine.act({ type: "begin" });
    await engine.act({ type: "opening", text: "My client is guilty, please convict. [concede]" });
    await engine.idle();
    const opening = engine.state.record.find((e) => e.speaker.kind === "player" && e.kind === "statement")!;
    expect(opening.tags).toContainEqual({ type: "concession", by: "defence" });
    for (const j of cf.jurors) {
      const change = engine.state.jurors[j.id]!.log.find((c) => c.entryId === opening.id);
      expect(change?.delta).toBe(-2);
    }
  });
});
