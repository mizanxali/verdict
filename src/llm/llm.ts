/**
 * The only code that talks to the Anthropic API.
 *
 * - Actors stream (client.beta.messages.stream), scorers use structured outputs
 *   (client.beta.messages.parse + betaZodOutputFormat). The beta namespace is used for every call
 *   because per-message effort (the only way to give actors `low` effort without splitting the
 *   prompt cache between roles) is typed only there; all calls send the same beta header.
 * - stop_reason is checked before content on every response ("refusal" arrives as HTTP 200).
 * - No fallback model. Actor refusal/failure -> { text, refused: true }. Scorer refusal or invalid
 *   output -> one retry, then null. API errors (after the SDK's own retries) -> refused / null.
 * - onUsage fires once per API call, including refused, failed, aborted and retried ones.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaMessage, BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import type { ActorResult, CreateLlm, Llm, LlmContext } from "../shared/contracts";
import {
  ACTOR_EFFORT,
  ACTOR_MAX_TOKENS,
  ACTOR_TIMEOUT_MS,
  BASE_EFFORT,
  MODEL,
  PER_MESSAGE_EFFORT_BETA,
  SCORER_MAX_TOKENS,
  SCORER_TIMEOUT_MS,
  SDK_MAX_RETRIES,
} from "./constants";
import { buildPrompt } from "./prompt";
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
import {
  finishConfront,
  finishFactCheck,
  finishJuryUpdate,
  finishLeakCheck,
  finishRuleCheck,
  finishRuling,
  WIRE,
} from "./schemas";
import { usageEntry, type ApiUsage } from "./usage";

// ───────────────────────── Logging (never the key, never prompts) ─────────────────────────

const short = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}...` : s);

function log(call: string, msg: string) {
  console.error(`[llm] ${call}: ${msg}`);
}

/** Typed SDK errors, most specific first. Messages are truncated so request text can't spill out. */
export function describeError(err: unknown): string {
  const rid = err instanceof Anthropic.APIError && err.requestID ? ` (request ${err.requestID})` : "";
  if (err instanceof Anthropic.APIUserAbortError) return "aborted";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timed out after retries";
  if (err instanceof Anthropic.APIConnectionError) return "connection failed after retries";
  if (err instanceof Anthropic.AuthenticationError) return `authentication failed; check ANTHROPIC_API_KEY${rid}`;
  if (err instanceof Anthropic.PermissionDeniedError) return `permission denied${rid}`;
  if (err instanceof Anthropic.NotFoundError) return `not found (model id?)${rid}`;
  if (err instanceof Anthropic.RateLimitError) return `rate limited after retries${rid}`;
  if (err instanceof Anthropic.BadRequestError) return `bad request: ${short(err.message)}${rid}`;
  if (err instanceof Anthropic.InternalServerError) return `server error ${err.status} after retries${rid}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}${rid}`;
  if (err instanceof Anthropic.AnthropicError) return `SDK error: ${short(err.message)}`;
  return `unexpected error: ${short(err instanceof Error ? err.message : String(err))}`;
}

function refusalNote(msg: BetaMessage): string {
  const d = (msg as { stop_details?: { category?: string | null } | null }).stop_details;
  return `refused${d?.category ? ` (category: ${d.category})` : ""}`;
}

const textOf = (msg: BetaMessage) =>
  msg.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

// ───────────────────────── Client ─────────────────────────

type ScoreOutcome<T> = { ok: true; value: T } | { ok: false; reason: string; retry: boolean };

export interface Shared {
  client: Anthropic;
  /**
   * Per-message effort is a beta. If the API rejects it (400), drop to top-level effort per role
   * for the rest of the process: it still works, but actors and scorers then stop sharing the
   * record cache (a top-level effort change invalidates the messages cache).
   */
  mode: { perMessageEffort: boolean };
  /** Per-call deadlines; defaults ACTOR_TIMEOUT_MS / SCORER_TIMEOUT_MS. */
  timeoutsMs?: { actor: number; scorer: number };
}

/** One SDK client per API key, shared by every Llm object (createLlm is called once per trial). */
const sharedByKey = new Map<string, Shared>();

function shared(apiKey: string | undefined): Shared {
  const key = apiKey ?? "";
  let s = sharedByKey.get(key);
  if (!s) {
    s = {
      client: new Anthropic({ ...(apiKey ? { apiKey } : {}), maxRetries: SDK_MAX_RETRIES }),
      mode: { perMessageEffort: true },
    };
    sharedByKey.set(key, s);
  }
  return s;
}

/** A signal that fires on the caller's abort or the deadline, whichever comes first. */
function deadline(ms: number, caller?: AbortSignal) {
  const timeout = AbortSignal.timeout(ms);
  return { signal: caller ? AbortSignal.any([caller, timeout]) : timeout, timedOut: () => timeout.aborted };
}

export const createLlm: CreateLlm = (opts = {}) => createLlmWith(shared(opts.apiKey));

/** @internal Build an Llm over a given client (tests pass one with a mocked fetch). */
export function createLlmWith({ client, mode, timeoutsMs }: Shared): Llm {
  const actorTimeout = timeoutsMs?.actor ?? ACTOR_TIMEOUT_MS;
  const scorerTimeout = timeoutsMs?.scorer ?? SCORER_TIMEOUT_MS;

  const params = (ctx: LlmContext, role: RolePrompt) => {
    const pme = mode.perMessageEffort;
    const actor = role.kind === "actor";
    const { system, messages } = buildPrompt(ctx, role, { perMessageEffort: actor && pme ? ACTOR_EFFORT : null });
    return {
      model: MODEL,
      max_tokens: actor ? ACTOR_MAX_TOKENS : SCORER_MAX_TOKENS,
      system,
      messages,
      effort: actor && !pme ? ACTOR_EFFORT : BASE_EFFORT,
      ...(pme ? { betas: [PER_MESSAGE_EFFORT_BETA] } : {}),
    };
  };

  const report = (
    role: RolePrompt,
    usage: BetaUsage | ApiUsage | null | undefined,
    started: number,
    stopReason: string | null,
    refused: boolean,
  ) => {
    const entry = usageEntry({ call: role.call, kind: role.kind, usage, ms: Date.now() - started, stopReason, refused });
    try {
      llm.onUsage?.(entry);
    } catch (err) {
      log(role.call, `onUsage threw: ${describeError(err)}`);
    }
  };

  // ── Actors ──

  type ActorRun = ActorResult & { failedWith?: unknown };

  async function streamActor(
    ctx: LlmContext,
    role: RolePrompt,
    onToken: (text: string) => void,
    signal: AbortSignal | undefined,
  ): Promise<ActorRun> {
    const { effort, ...p } = params(ctx, role);
    const started = Date.now();
    let text = "";
    const dl = deadline(actorTimeout, signal);
    const stream = client.beta.messages.stream({ ...p, output_config: { effort } }, { signal: dl.signal });
    stream.on("text", (delta) => {
      text += delta;
      try {
        onToken(delta);
      } catch (err) {
        log(role.call, `onToken threw: ${describeError(err)}`);
      }
    });
    try {
      const msg = await stream.finalMessage();
      const refused = msg.stop_reason === "refusal";
      report(role, msg.usage, started, msg.stop_reason, refused);
      if (refused) {
        log(role.call, refusalNote(msg));
        return { text, refused: true };
      }
      if (msg.stop_reason === "max_tokens") log(role.call, "hit max_tokens; reply may be cut short");
      return { text: (textOf(msg) || text).trim(), refused: false };
    } catch (err) {
      const partial = stream.currentMessage?.usage;
      if (signal?.aborted) {
        // Aborted by the caller: resolve normally with what had arrived.
        report(role, partial, started, null, false);
        return { text: text.trim(), refused: false };
      }
      report(role, partial, started, null, true);
      if (dl.timedOut()) {
        log(role.call, `no reply within ${actorTimeout / 1000}s; treating as refused`);
        return { text: text.trim(), refused: true };
      }
      return { text: text.trim(), refused: true, failedWith: err };
    }
  }

  async function runActor(
    ctx: LlmContext,
    role: RolePrompt,
    onToken: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ActorResult> {
    if (signal?.aborted) return { text: "", refused: false };
    const usedPme = mode.perMessageEffort;
    let r = await streamActor(ctx, role, onToken, signal);
    if (r.failedWith instanceof Anthropic.BadRequestError && usedPme && r.text === "") {
      log(role.call, `${describeError(r.failedWith)}; retrying without per-message effort`);
      mode.perMessageEffort = false;
      r = await streamActor(ctx, role, onToken, signal);
      if (r.failedWith) mode.perMessageEffort = true; // the beta was not the problem
    }
    if (r.failedWith) log(role.call, describeError(r.failedWith));
    return { text: r.text, refused: r.refused };
  }

  // ── Scorers ──

  async function scoreOnce<T>(
    ctx: LlmContext,
    role: RolePrompt,
    wire: z.ZodType,
    finish: (raw: unknown) => T | null,
  ): Promise<ScoreOutcome<T>> {
    const { effort, ...p } = params(ctx, role);
    const base = betaZodOutputFormat(wire);
    // Never throw from parse: a refusal or truncation can leave partial JSON, and the response
    // (with its usage) must survive so it can be reported and the stop reason checked first.
    const format = {
      ...base,
      parse: (content: string): { ok: true; value: unknown } | { ok: false } => {
        try {
          return { ok: true, value: base.parse(content) };
        } catch {
          return { ok: false };
        }
      },
    };
    const started = Date.now();
    const dl = deadline(scorerTimeout);
    let msg;
    try {
      msg = await client.beta.messages.parse({ ...p, output_config: { effort, format } }, { signal: dl.signal });
    } catch (err) {
      report(role, null, started, null, true);
      const reason = dl.timedOut() ? `no reply within ${scorerTimeout / 1000}s` : describeError(err);
      return { ok: false, reason, retry: false };
    }
    const refused = msg.stop_reason === "refusal";
    report(role, msg.usage, started, msg.stop_reason, refused);
    if (refused) return { ok: false, reason: refusalNote(msg), retry: true };
    if (msg.stop_reason === "max_tokens") return { ok: false, reason: "hit max_tokens", retry: true };
    const parsed = msg.parsed_output;
    if (!parsed || !parsed.ok) return { ok: false, reason: "output did not match the schema", retry: true };
    const value = finish(parsed.value);
    if (value === null) return { ok: false, reason: "output failed validation", retry: true };
    return { ok: true, value };
  }

  async function score<T>(
    ctx: LlmContext,
    role: RolePrompt,
    wire: z.ZodType,
    finish: (raw: unknown) => T | null,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await scoreOnce(ctx, role, wire, finish);
      if (r.ok) return r.value;
      const last = attempt === 2 || !r.retry;
      log(role.call, `${r.reason}${last ? "; returning null" : "; retrying once"}`);
      if (last) return null;
    }
    return null;
  }

  const llm: Llm = {
    actor: (ctx, req, onToken, signal) => runActor(ctx, actorPrompt(ctx.caseFile, req), onToken, signal),
    factCheck: (ctx, req) =>
      score(ctx, factCheckPrompt(ctx.caseFile, req), WIRE.factCheck, (raw) => finishFactCheck(raw, ctx, req)),
    ruleCheck: (ctx, req) =>
      score(ctx, ruleCheckPrompt(ctx.caseFile, req), WIRE.ruleCheck, (raw) => finishRuleCheck(raw, ctx, req)),
    ruling: (ctx, req) =>
      score(ctx, rulingPrompt(ctx.caseFile, req), WIRE.ruling, (raw) => finishRuling(raw, ctx, req)),
    confront: (ctx, req) =>
      score(ctx, confrontPrompt(ctx.caseFile, req), WIRE.confront, (raw) => finishConfront(raw, ctx, req)),
    juryUpdate: (ctx, req) =>
      score(ctx, juryPrompt(ctx.caseFile, req), WIRE.juryUpdate, (raw) => finishJuryUpdate(raw, ctx, req)),
    leakCheck: (ctx, req) =>
      score(ctx, leakCheckPrompt(ctx.caseFile, req), WIRE.leakCheck, (raw) => finishLeakCheck(raw, ctx, req)),
  };
  return llm;
}
