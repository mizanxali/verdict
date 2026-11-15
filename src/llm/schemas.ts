/**
 * Scorer output handling: the schema sent to structured outputs ("wire") and the strict
 * validation applied afterwards. Code never applies scorer output it has not validated.
 *
 * Structured outputs reject nothing in these schemas, but they do not enforce numeric bounds
 * (`minimum`/`maximum` are unsupported; the SDK helper moves them into the description). So the
 * jury wire schema spells `delta` as an enum of the five allowed integers, which the grammar does
 * enforce, and the strict contract schema (`JurorDelta`, int -2..2) is checked again here.
 */
import { z } from "zod";
import type {
  ConfrontRequest,
  FactCheckRequest,
  JuryUpdateRequest,
  LeakCheckRequest,
  LlmContext,
  RuleCheckRequest,
  RulingRequest,
} from "../shared/contracts";
import {
  Confront,
  FactCheck,
  JuryUpdate,
  LeakCheck,
  RuleCheck,
  Ruling,
  type Confront as ConfrontT,
  type FactCheck as FactCheckT,
  type JuryUpdate as JuryUpdateT,
  type LeakCheck as LeakCheckT,
  type RuleCheck as RuleCheckT,
  type Ruling as RulingT,
} from "../shared/types";

export const JuryUpdateWire = z.object({
  jurors: z.array(
    z.object({
      jurorId: z.string(),
      delta: z.literal([-2, -1, 0, 1, 2]),
      reason: z.string(),
    }),
  ),
});

export const FactCheckWire = FactCheck.extend({ concedesOwnCase: z.boolean() });

export const WIRE = {
  factCheck: FactCheckWire,
  ruleCheck: RuleCheck,
  ruling: Ruling,
  confront: Confront,
  juryUpdate: JuryUpdateWire,
  leakCheck: LeakCheck,
} as const;

// ───────────────────────── Strict validation + normalisation ─────────────────────────

export function finishFactCheck(raw: unknown, ctx: LlmContext, req: FactCheckRequest): FactCheckT | null {
  const r = FactCheck.safeParse(raw);
  if (!r.success) return null;
  // A ref counts only if it is the public brief, a witness's prior statement in the case file,
  // an exhibit this speaker may rely on, or an unstricken record entry.
  const valid = new Set<string>([
    "brief",
    ...ctx.caseFile.witnesses.map((w) => `statement:${w.id}`),
    ...req.allowedExhibitIds,
    ...ctx.record.filter((e) => !e.stricken).map((e) => e.id),
  ]);
  return {
    concedesOwnCase: r.data.concedesOwnCase,
    claims: r.data.claims.map((c) => {
      const refs = c.refs.filter((ref) => valid.has(ref));
      if (c.verdict === "unsupported") return { ...c, refs: [] };
      if (refs.length === 0) {
        // "supported"/"contradicted" need a source the speaker may use; without one it is unsupported.
        return { ...c, verdict: "unsupported" as const, refs: [], reason: `${c.reason} (no admissible source cited)` };
      }
      return { ...c, refs };
    }),
  };
}

export function finishRuleCheck(raw: unknown, _ctx: LlmContext, req: RuleCheckRequest): RuleCheckT | null {
  const r = RuleCheck.safeParse(raw);
  if (!r.success) return null;
  const best = new Map<string, RuleCheckT["violations"][number]>();
  for (const v of r.data.violations) {
    if (v.objection === "leading" && req.mode === "cross") continue; // leading is allowed on cross
    const prev = best.get(v.objection);
    if (!prev || (prev.severity === "arguable" && v.severity === "clear")) best.set(v.objection, v);
  }
  return { violations: [...best.values()] };
}

export function finishRuling(raw: unknown, _ctx: LlmContext, req: RulingRequest): RulingT | null {
  const r = Ruling.safeParse(raw);
  if (!r.success) return null;
  const out = { ...r.data, objection: req.ground };
  if (req.ground === "leading" && req.mode === "cross" && out.sustained) {
    return { ...out, sustained: false, reason: "Leading questions are permitted on cross-examination." };
  }
  return out;
}

export function finishConfront(raw: unknown, _ctx: LlmContext, req: ConfrontRequest): ConfrontT | null {
  const r = Confront.safeParse(raw);
  if (!r.success) return null;
  return { ...r.data, lieId: req.lieId };
}

/** Exactly one entry per juror; returned in request order even if the model reordered them. */
export function finishJuryUpdate(raw: unknown, _ctx: LlmContext, req: JuryUpdateRequest): JuryUpdateT | null {
  const r = JuryUpdate.safeParse(raw);
  if (!r.success) return null;
  const byId = new Map(r.data.jurors.map((j) => [j.jurorId, j]));
  if (byId.size !== r.data.jurors.length || byId.size !== req.jurors.length) return null;
  const ordered = req.jurors.map((j) => byId.get(j.id));
  if (ordered.some((j) => j === undefined)) return null;
  return { jurors: ordered as JuryUpdateT["jurors"] };
}

export function finishLeakCheck(raw: unknown, _ctx: LlmContext, req: LeakCheckRequest): LeakCheckT | null {
  const r = LeakCheck.safeParse(raw);
  if (!r.success) return null;
  const byId = new Map(r.data.leaks.map((l) => [l.lieId, l]));
  if (byId.size !== r.data.leaks.length || byId.size !== req.heldLies.length) return null;
  const ordered = req.heldLies.map((l) => byId.get(l.id));
  if (ordered.some((l) => l === undefined)) return null;
  return { leaks: (ordered as LeakCheckT["leaks"]).map((l) => (l.abandoned ? l : { ...l, quote: "" })) };
}
