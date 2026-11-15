/**
 * Assembles the request body around the one shared, cached prefix.
 *
 *   system      [rules + public case file]                         <- breakpoint 1
 *   messages[0] user: [record header, r1, r2, ..., rN, (struck note)]
 *                     breakpoint on rN, plus one on every RECORD_CHUNK-th entry
 *                     (only the latest such one is marked: 3 breakpoints at most, limit is 4)
 *   -- everything above is byte-identical for every role --
 *   actors only: system {content: [], output_config: {effort: "low"}}  (per-message effort)
 *   user:   the cue (question / entry to score)
 *   system: the role's instructions and private knowledge
 *
 * A record that grows only appends blocks, so earlier breakpoints keep hitting.
 */
import type { BetaMessageParam, BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { LlmContext } from "../shared/contracts";
import type { CaseFile } from "../shared/types";
import { RECORD_CHUNK, type Effort } from "./constants";
import { RECORD_EMPTY, RECORD_HEADER, renderEntry, renderStrickenNote, renderSystem } from "./prompts/shared";
import type { RolePrompt } from "./prompts/role";

const EPHEMERAL = { type: "ephemeral" } as const;

export function buildSystem(caseFile: CaseFile): BetaTextBlockParam[] {
  return [{ type: "text", text: renderSystem(caseFile), cache_control: EPHEMERAL }];
}

/** The first user message: the record, one block per entry. */
export function buildRecordMessage(ctx: LlmContext): BetaMessageParam {
  const blocks: BetaTextBlockParam[] = [{ type: "text", text: RECORD_HEADER }];
  if (ctx.record.length === 0) {
    blocks.push({ type: "text", text: RECORD_EMPTY, cache_control: EPHEMERAL });
  } else {
    const last = ctx.record.length - 1;
    // Latest stable chunk boundary strictly before the last entry.
    const boundary = Math.floor(last / RECORD_CHUNK) * RECORD_CHUNK - 1;
    ctx.record.forEach((entry, i) => {
      const block: BetaTextBlockParam = { type: "text", text: renderEntry(ctx.caseFile, entry) };
      if (i === last || i === boundary) block.cache_control = EPHEMERAL;
      blocks.push(block);
    });
  }
  const struck = renderStrickenNote(ctx.record);
  if (struck) blocks.push({ type: "text", text: struck }); // after the breakpoint: may change freely
  return { role: "user", content: blocks };
}

export interface BuildOptions {
  /** Effort for this reply via a per-message system message, or null to rely on top-level effort. */
  perMessageEffort: Effort | null;
}

export function buildMessages(ctx: LlmContext, role: RolePrompt, opts: BuildOptions): BetaMessageParam[] {
  const messages: BetaMessageParam[] = [buildRecordMessage(ctx)];
  if (opts.perMessageEffort) {
    // On its own (not adjacent to a system message with content) it may sit anywhere; it
    // applies from the next user turn with new input, i.e. the cue below.
    messages.push({ role: "system", content: [], output_config: { effort: opts.perMessageEffort } });
  }
  messages.push({ role: "user", content: [{ type: "text", text: role.cue }] });
  // Mid-conversation system message: follows a user turn and is the last entry.
  messages.push({ role: "system", content: [{ type: "text", text: role.instructions }] });
  return messages;
}

export function buildPrompt(ctx: LlmContext, role: RolePrompt, opts: BuildOptions) {
  return { system: buildSystem(ctx.caseFile), messages: buildMessages(ctx, role, opts) };
}

/** The shared prefix as the API sees it, for tests and the smoke script. */
export function sharedPrefix(ctx: LlmContext): { system: BetaTextBlockParam[]; record: BetaMessageParam } {
  return { system: buildSystem(ctx.caseFile), record: buildRecordMessage(ctx) };
}

/** Strip cache_control markers (they move between requests and are not part of the cache key). */
export function stripCacheControl<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (k, v) => (k === "cache_control" ? undefined : v)));
}
