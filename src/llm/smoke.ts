/**
 * Live smoke test: two cheap calls (one actor, one scorer) over the same shared prefix, then a
 * report on stop reasons, usage, and whether the second call read the cache the first wrote.
 *
 *   npx tsx --env-file-if-exists=.env.local src/llm/smoke.ts
 *
 * Reads ANTHROPIC_API_KEY from the environment and never prints it. Costs well under one cent.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { LlmContext } from "../shared/contracts";
import type { CaseFile, UsageEntry } from "../shared/types";
import { MIN_CACHEABLE_TOKENS, MODEL, PER_MESSAGE_EFFORT_BETA } from "./constants";
import { createLlm } from "./index";
import { miniCase, miniRecord } from "./miniCase";
import { sharedPrefix } from "./prompt";

/** Comfortably above the minimum, since the count below is an estimate of the cached span. */
const TARGET_PREFIX_TOKENS = MIN_CACHEABLE_TOKENS * 2;

function padded(cf: CaseFile, paragraphs: number): CaseFile {
  const pad = Array.from(
    { length: paragraphs },
    (_, i) =>
      `Background note ${i + 1}: the Harbour Society reading room holds charts, tide tables and logbooks donated by members over many years, and is used for evening meetings of the society's committees.`,
  ).join("\n");
  return paragraphs ? { ...cf, publicBrief: `${cf.publicBrief}\n\n${pad}` } : cf;
}

async function prefixTokens(client: Anthropic, ctx: LlmContext): Promise<number | null> {
  const { system, record } = sharedPrefix(ctx);
  try {
    const r = await client.beta.messages.countTokens({ model: MODEL, system, messages: [record], betas: [PER_MESSAGE_EFFORT_BETA] });
    return r.input_tokens;
  } catch (err) {
    console.log(`  (token count unavailable: ${err instanceof Anthropic.APIError ? `API error ${err.status}` : "error"})`);
    return null;
  }
}

function show(label: string, u: UsageEntry | undefined) {
  if (!u) return console.log(`${label}: no usage reported`);
  console.log(
    `${label}: stop_reason=${u.stopReason} refused=${u.refused} input=${u.inputTokens} cache_read=${u.cacheReadTokens} cache_write=${u.cacheWriteTokens} output=${u.outputTokens} cost=$${u.costUsd.toFixed(5)} ${u.ms}ms`,
  );
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set (put it in .env.local or the environment).");
    process.exit(1);
  }
  const counter = new Anthropic();

  // 1. Make sure the shared prefix is long enough to cache.
  let caseFile = miniCase;
  let ctx: LlmContext = { caseFile, record: miniRecord() };
  let tokens = await prefixTokens(counter, ctx);
  for (let pad = 8; tokens !== null && tokens < TARGET_PREFIX_TOKENS && pad <= 64; pad *= 2) {
    caseFile = padded(miniCase, pad);
    ctx = { caseFile, record: miniRecord() };
    tokens = await prefixTokens(counter, ctx);
    console.log(`Prefix padded with ${pad} background paragraphs.`);
  }
  if (tokens === null) {
    console.log(`Shared prefix size unknown; if call 2 shows no cache read, check it is above ${MIN_CACHEABLE_TOKENS} tokens.`);
  } else {
    const note = tokens < MIN_CACHEABLE_TOKENS ? ` WARNING: below the ${MIN_CACHEABLE_TOKENS}-token minimum, will not cache` : "";
    console.log(`Shared prefix (system + record): ${tokens} tokens; minimum cacheable for ${MODEL} is ${MIN_CACHEABLE_TOKENS}.${note}`);
  }

  // 2. Two calls over the identical prefix, sequentially (a cache entry is readable only once
  //    the first response has started).
  const llm = createLlm();
  const usages: UsageEntry[] = [];
  llm.onUsage = (u) => usages.push(u);

  console.log("\nCall 1 (actor: judge ruling line, effort low)...");
  const actor = await llm.actor(
    ctx,
    { role: "judge", task: "ruling_line", objector: "defence", ruling: { objection: "leading", sustained: true, ruleCited: "Leading", reason: "The question suggests its answer on direct examination." } },
    () => {},
  );
  console.log(`  text: ${JSON.stringify(actor.text)} refused=${actor.refused}`);
  const afterActor = usages.length;

  console.log("Call 2 (scorer: rule check, effort medium, structured output)...");
  const check = await llm.ruleCheck(ctx, {
    speaker: "prosecution",
    entry: { id: "r5", phase: "w1_direct", speaker: { kind: "prosecutor" }, kind: "question", text: "You locked up at eight, didn't you?", exhibitIds: [], stricken: false, tags: [] },
    mode: "direct",
    witnessId: "moss",
  });
  console.log(`  result: ${JSON.stringify(check)}`);

  console.log("");
  usages.slice(0, afterActor).forEach((u, i) => show(`Call 1${afterActor > 1 ? ` attempt ${i + 1}` : ""}`, u));
  usages.slice(afterActor).forEach((u, i) => show(`Call 2${usages.length - afterActor > 1 ? ` attempt ${i + 1}` : ""}`, u));

  const second = usages[afterActor];
  const hit = (second?.cacheReadTokens ?? 0) > 0;
  console.log(
    hit
      ? `\nCache hit on call 2: ${second!.cacheReadTokens} tokens read from the prefix call 1 wrote (actor and scorer share one cache).`
      : `\nNo cache hit on call 2 (cache_read_input_tokens = 0). Either the prefix is too short, or something in the request (effort, output format, headers) splits the cache between roles.`,
  );
  const total = usages.reduce((s, u) => s + u.costUsd, 0);
  console.log(`Total: ${usages.length} API calls, $${total.toFixed(5)}`);
  process.exit(hit && !actor.refused && check !== null ? 0 : 1);
}

main().catch((err) => {
  console.error(`smoke failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}`);
  process.exit(1);
});
