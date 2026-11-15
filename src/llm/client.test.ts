/**
 * Drives the real SDK client against a mocked fetch: no network, no key. Checks request shape
 * (model, effort, beta header, cache layout, no sampling params / fallbacks) and the handling of
 * streaming, refusals, aborts, invalid output and API errors.
 */
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageEntry } from "../shared/types";
import { MODEL, PER_MESSAGE_EFFORT_BETA } from "./constants";
import { createLlmWith } from "./llm";
import { miniCase, miniCtx, mossBrief } from "./miniCase";

type Reply =
  | { kind: "stream"; chunks: string[]; stop: string; hang?: boolean }
  | { kind: "json"; text: string; stop: string }
  | { kind: "error"; status: number }
  | { kind: "hang" };

interface Seen {
  body: Record<string, any>;
  headers: Headers;
}

const usage = { input_tokens: 20, output_tokens: 7, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 };
const message = (content: unknown[], stop: string | null) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: MODEL,
  content,
  stop_reason: stop,
  stop_sequence: null,
  usage,
});

function sse(reply: Extract<Reply, { kind: "stream" }>, signal?: AbortSignal | null): Response {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(ev("message_start", { message: message([], null) })));
      c.enqueue(enc.encode(ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } })));
      for (const t of reply.chunks) c.enqueue(enc.encode(ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } })));
      if (reply.hang) {
        signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        return;
      }
      c.enqueue(enc.encode(ev("content_block_stop", { index: 0 })));
      c.enqueue(enc.encode(ev("message_delta", { delta: { stop_reason: reply.stop, stop_sequence: null }, usage: { output_tokens: 7 } })));
      c.enqueue(enc.encode(ev("message_stop", {})));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function harness(replies: Reply[], timeoutsMs?: { actor: number; scorer: number }) {
  const seen: Seen[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    const r = replies.shift();
    if (!r) throw new Error("unexpected call");
    if (r.kind === "error")
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "boom" } }), { status: r.status, headers: { "content-type": "application/json" } });
    if (r.kind === "hang")
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    if (r.kind === "json") return new Response(JSON.stringify(message([{ type: "text", text: r.text }], r.stop)), { status: 200, headers: { "content-type": "application/json" } });
    return sse(r, init?.signal);
  });
  const client = new Anthropic({ apiKey: "test-key", fetch: fetch as unknown as typeof globalThis.fetch, maxRetries: 0 });
  const llm = createLlmWith({ client, mode: { perMessageEffort: true }, timeoutsMs });
  const usages: UsageEntry[] = [];
  llm.onUsage = (u) => usages.push(u);
  return { llm, seen, usages, fetch };
}

const ctx = miniCtx();
const question = { ...ctx.record[2]!, id: "r5", phase: "w1_cross" as const, speaker: { kind: "player" as const } };
const witnessReq = { role: "witness" as const, brief: mossBrief(), examiner: "defence" as const, mode: "cross" as const, question };
const confrontReq = { witnessId: "moss", lieId: "moss-return", coverStory: "c", mustConfront: "m", exhibitIds: ["E1"], entry: question };

afterEach(() => vi.restoreAllMocks());

describe("actor calls", () => {
  it("stream tokens and send the shared layout with per-message low effort", async () => {
    const h = harness([{ kind: "stream", chunks: ["I went ", "straight home."], stop: "end_turn" }]);
    const tokens: string[] = [];
    const r = await h.llm.actor(ctx, witnessReq, (t) => tokens.push(t));
    expect(r).toEqual({ text: "I went straight home.", refused: false });
    expect(tokens).toEqual(["I went ", "straight home."]);
    const { body, headers } = h.seen[0]!;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(headers.get("anthropic-beta")).toContain(PER_MESSAGE_EFFORT_BETA);
    for (const k of ["temperature", "top_p", "top_k", "thinking", "fallbacks", "tool_choice"]) expect(body).not.toHaveProperty(k);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "system", "user", "system"]);
    expect(body.messages[1]).toEqual({ role: "system", content: [], output_config: { effort: "low" } });
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(h.usages).toHaveLength(1);
    expect(h.usages[0]).toMatchObject({ call: "actor:witness:moss", kind: "actor", cacheReadTokens: 900, cacheWriteTokens: 40, refused: false, stopReason: "end_turn" });
    expect(h.usages[0]!.costUsd).toBeCloseTo((20 * 4 + 900 * 0.2 + 40 * 5 + 7 * 20) / 1e6, 12);
  });

  it("resolve refused: true on a mid-stream refusal", async () => {
    const h = harness([{ kind: "stream", chunks: ["Well"], stop: "refusal" }]);
    const r = await h.llm.actor(ctx, witnessReq, () => {});
    expect(r.refused).toBe(true);
    expect(h.usages[0]).toMatchObject({ refused: true, stopReason: "refusal" });
  });

  it("resolve normally with the partial text when the caller aborts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness([{ kind: "stream", chunks: ["I was "], stop: "end_turn", hang: true }]);
    const ac = new AbortController();
    const r = await h.llm.actor(ctx, witnessReq, () => ac.abort(), ac.signal);
    expect(r).toEqual({ text: "I was", refused: false });
    expect(h.usages).toHaveLength(1);
    expect(h.usages[0]!.refused).toBe(false);
  });

  it("fall back to top-level effort if the per-message effort beta is rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness([
      { kind: "error", status: 400 },
      { kind: "stream", chunks: ["Sustained."], stop: "end_turn" },
      { kind: "json", text: JSON.stringify({ lieId: "x", confronted: true, reason: "r" }), stop: "end_turn" },
    ]);
    const r = await h.llm.actor(ctx, { role: "judge", task: "ruling_line", ruling: { objection: "leading", sustained: true, ruleCited: "Leading", reason: "r" }, objector: "defence" }, () => {});
    expect(r).toEqual({ text: "Sustained.", refused: false });
    expect(h.usages).toHaveLength(2);
    const retry = h.seen[1]!;
    expect(retry.body.output_config).toEqual({ effort: "low" });
    expect(retry.headers.get("anthropic-beta") ?? "").not.toContain(PER_MESSAGE_EFFORT_BETA);
    expect(retry.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "user", "system"]);
    await h.llm.confront(ctx, confrontReq); // later scorers follow suit
    expect(h.seen[2]!.headers.get("anthropic-beta") ?? "").not.toContain(PER_MESSAGE_EFFORT_BETA);
  });

  it("resolve refused: true on an API error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness([{ kind: "error", status: 500 }]);
    const r = await h.llm.actor(ctx, { role: "prosecutor", task: "opening" }, () => {});
    expect(r.refused).toBe(true);
    expect(h.usages).toHaveLength(1);
  });
});

describe("scorer calls", () => {
  it("use structured outputs at medium effort and return validated output", async () => {
    const h = harness([{ kind: "json", text: JSON.stringify({ lieId: "wrong", confronted: true, reason: "Puts the 21:41 entry to him." }), stop: "end_turn" }]);
    const r = await h.llm.confront(ctx, confrontReq);
    expect(r).toEqual({ lieId: "moss-return", confronted: true, reason: "Puts the 21:41 entry to him." });
    const { body, headers } = h.seen[0]!;
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(headers.get("anthropic-beta")).toContain(PER_MESSAGE_EFFORT_BETA);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "user", "system"]);
    expect(h.usages[0]).toMatchObject({ call: "scorer:confront", kind: "scorer", refused: false });
  });

  it("retry once after a refusal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness([
      { kind: "json", text: "", stop: "refusal" },
      { kind: "json", text: JSON.stringify({ violations: [] }), stop: "end_turn" },
    ]);
    const r = await h.llm.ruleCheck(ctx, { speaker: "defence", entry: question, mode: "cross", witnessId: "moss" });
    expect(r).toEqual({ violations: [] });
    expect(h.usages.map((u) => u.refused)).toEqual([true, false]);
  });

  it("return null after two invalid outputs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = JSON.stringify({ jurors: miniCase.jurors.slice(1).map((j) => ({ jurorId: j.id, delta: 0, reason: "r" })) });
    const h = harness([
      { kind: "json", text: bad, stop: "end_turn" },
      { kind: "json", text: '{"jurors": [', stop: "max_tokens" },
    ]);
    const r = await h.llm.juryUpdate(ctx, {
      exchange: ctx.record.slice(2),
      tags: [],
      jurors: miniCase.jurors.map((j) => ({ id: j.id, name: j.name, persona: j.persona, disposition: j.disposition, lean: 0 })),
    });
    expect(r).toBeNull();
    expect(h.usages).toHaveLength(2);
  });

  it("return null on an API error without retrying it themselves", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness([{ kind: "error", status: 401 }]);
    const r = await h.llm.factCheck(ctx, { speaker: "defence", entry: question, allowedExhibitIds: [] });
    expect(r).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.usages).toHaveLength(1);
    const logged = errors.mock.calls.flat().join(" ");
    expect(logged).toContain("authentication failed");
    expect(logged).not.toContain("test-key");
  });
});

describe("deadlines", () => {
  it("an actor that streams past its deadline resolves refused: true", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness([{ kind: "stream", chunks: ["Half an "], stop: "end_turn", hang: true }], { actor: 50, scorer: 50 });
    const r = await h.llm.actor(ctx, witnessReq, () => {});
    expect(r).toEqual({ text: "Half an", refused: true });
    expect(h.usages).toHaveLength(1);
  });

  it("a scorer with no reply by its deadline returns null without retrying", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = harness([{ kind: "hang" }], { actor: 50, scorer: 50 });
    expect(await h.llm.confront(ctx, confrontReq)).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.usages).toHaveLength(1);
  });
});
