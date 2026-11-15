/**
 * Deterministic stand-in for the real model layer. Free, instant, and steerable from the
 * text of the entry being scored, so engine tests, the UI and the harness can run offline.
 *
 * Markers (put them anywhere in a question or statement):
 *   [unsupported]      factCheck returns one unsupported claim
 *   [contradicted]     factCheck returns one contradicted claim
 *   [concede]          factCheck reports that the speaker conceded their own case
 *   [violation:TYPE]   ruleCheck returns a clear violation of TYPE (e.g. [violation:leading]);
 *                      ruling() sustains an objection on exactly that ground
 *   [confront]         confront() returns confronted: true
 *   [refuse]           actor() answering this question returns refused: true
 *
 * juryUpdate: every juror moves +2 / -2 for a lie cracked by defence / prosecution,
 * -1 / +1 for a claim flagged against defence / prosecution, -2 / +2 for a concession by
 * defence / prosecution, otherwise 0.
 */
import type { Llm } from "./contracts";
import type { ObjectionType, UsageEntry } from "./types";

const usage = (call: string, kind: "actor" | "scorer"): UsageEntry => ({
  call,
  kind,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  ms: 0,
  stopReason: "end_turn",
  refused: false,
});

export function createFakeLlm(opts: { tokenDelayMs?: number } = {}): Llm {
  const delay = opts.tokenDelayMs ?? 0;
  const violationIn = (text: string): ObjectionType | null => {
    const m = text.match(/\[violation:(\w+)\]/);
    return m ? (m[1] as ObjectionType) : null;
  };

  const llm: Llm = {
    async actor(_ctx, req, onToken, signal) {
      let text: string;
      if (req.role === "witness") {
        if (req.question.text.includes("[refuse]")) {
          llm.onUsage?.({ ...usage(`actor:witness:${req.brief.witnessId}`, "actor"), refused: true, stopReason: "refusal" });
          return { text: "", refused: true };
        }
        const cracked = req.brief.lies.find((l) => l.justCracked);
        text = cracked
          ? `(${req.brief.name}, shaken) All right. ${cracked.concession ?? "That was not true."}`
          : `(${req.brief.name}) I stand by my statement.`;
      } else if (req.role === "prosecutor") {
        text =
          req.task === "question"
            ? `Tell the court about this: ${req.step.topic}?`
            : req.task === "opening"
              ? "Members of the jury, the evidence will show the defendant is guilty."
              : "Members of the jury, you have heard enough to convict.";
      } else {
        text = req.ruling.sustained ? "Sustained." : "Overruled. Move along, counsel.";
      }
      let out = "";
      for (const word of text.split(/(?<= )/)) {
        if (signal?.aborted) break;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        out += word;
        onToken(word);
      }
      llm.onUsage?.(usage(`actor:${req.role}`, "actor"));
      return { text: out, refused: false };
    },

    async factCheck(_ctx, req) {
      llm.onUsage?.(usage("scorer:factcheck", "scorer"));
      const t = req.entry.text;
      const claims = [];
      if (t.includes("[unsupported]"))
        claims.push({ text: t, verdict: "unsupported" as const, refs: [], reason: "fake: marker" });
      if (t.includes("[contradicted]"))
        claims.push({ text: t, verdict: "contradicted" as const, refs: [], reason: "fake: marker" });
      return { claims, concedesOwnCase: t.includes("[concede]") };
    },

    async ruleCheck(_ctx, req) {
      llm.onUsage?.(usage("scorer:rulecheck", "scorer"));
      const v = violationIn(req.entry.text);
      return { violations: v ? [{ objection: v, severity: "clear" as const, reason: "fake: marker" }] : [] };
    },

    async ruling(_ctx, req) {
      llm.onUsage?.(usage("scorer:ruling", "scorer"));
      const v = violationIn(req.entry.text);
      const flagged = req.ground === "assumes_facts" && /\[(unsupported|contradicted)\]/.test(req.entry.text);
      const sustained = v === req.ground || flagged;
      return { objection: req.ground, sustained, ruleCited: req.ground, reason: "fake: marker" };
    },

    async confront(_ctx, req) {
      llm.onUsage?.(usage("scorer:confront", "scorer"));
      return { lieId: req.lieId, confronted: req.entry.text.includes("[confront]"), reason: "fake: marker" };
    },

    async juryUpdate(_ctx, req) {
      llm.onUsage?.(usage("scorer:jury", "scorer"));
      let delta = 0;
      for (const tag of req.tags) {
        if (tag.type === "lie_cracked") delta += tag.by === "defence" ? 2 : -2;
        if (tag.type === "claim_flagged") delta += tag.by === "defence" ? -1 : 1;
        if (tag.type === "concession") delta += tag.by === "defence" ? -2 : 2;
      }
      delta = Math.max(-2, Math.min(2, delta));
      return { jurors: req.jurors.map((j) => ({ jurorId: j.id, delta, reason: "fake: from tags" })) };
    },

    async leakCheck(_ctx, req) {
      llm.onUsage?.(usage("scorer:leak", "scorer"));
      return { leaks: req.heldLies.map((l) => ({ lieId: l.id, abandoned: false, quote: "" })) };
    },
  };
  return llm;
}
