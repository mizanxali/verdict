/**
 * Validation for player actions arriving over HTTP. The engine is the authority on whether an
 * action fits the current state; this only guarantees shape, trims free text and caps its length.
 */
import { z } from "zod";
import { ObjectionType, type Pending, type PlayerAction } from "../shared/types";

export const MAX_TEXT = 1200;
const MAX_EXHIBITS = 12;

const freeText = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, "Say something before you submit.")
      .max(MAX_TEXT, `Keep it under ${MAX_TEXT} characters.`),
  );

export const PlayerActionBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("begin") }),
  z.object({ type: z.literal("opening"), text: freeText }),
  z.object({
    type: z.literal("ask"),
    text: freeText,
    exhibitIds: z
      .array(z.string().regex(/^E\d+$/, "Unknown exhibit id."))
      .max(MAX_EXHIBITS)
      .default([])
      .transform((ids) => [...new Set(ids)]),
  }),
  z.object({ type: z.literal("end_cross") }),
  z.object({ type: z.literal("object"), ground: ObjectionType }),
  z.object({ type: z.literal("pass") }),
  z.object({ type: z.literal("closing"), text: freeText }),
]);

/** Which pending state each action answers. Used for a fast 409 before calling the engine. */
const ANSWERS: Record<PlayerAction["type"], Exclude<Pending, null>> = {
  begin: "begin",
  opening: "opening",
  ask: "question",
  end_cross: "question",
  object: "objection_window",
  pass: "objection_window",
  closing: "closing",
};

export function actionFits(pending: Pending, action: PlayerAction): boolean {
  return pending !== null && ANSWERS[action.type] === pending;
}

export function parseAction(body: unknown): { ok: true; action: PlayerAction } | { ok: false; message: string } {
  const r = PlayerActionBody.safeParse(body);
  if (r.success) return { ok: true, action: r.data as PlayerAction };
  const issue = r.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return { ok: false, message: `Invalid action. ${where}${issue?.message ?? "Malformed body."}` };
}
