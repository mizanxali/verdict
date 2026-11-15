import type { UsageEntry } from "../shared/types";
import { PRICE_PER_MTOK } from "./constants";

/** The subset of the API's `usage` object this module reads. All fields may be absent on errors. */
export interface ApiUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

export interface TokenCounts {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  outputTokens: number;
}

export function tokenCounts(usage: ApiUsage | null | undefined): TokenCounts {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const write = n(usage?.cache_creation_input_tokens);
  const write1h = n(usage?.cache_creation?.ephemeral_1h_input_tokens);
  return {
    inputTokens: n(usage?.input_tokens),
    cacheReadTokens: n(usage?.cache_read_input_tokens),
    // Without a TTL breakdown, every write is a 5-minute write (the only TTL we request).
    cacheWrite5mTokens: Math.max(0, write - write1h),
    cacheWrite1hTokens: write1h,
    outputTokens: n(usage?.output_tokens),
  };
}

export function costUsd(t: TokenCounts): number {
  const p = PRICE_PER_MTOK;
  const micro =
    t.inputTokens * p.input +
    t.cacheReadTokens * p.cacheRead +
    t.cacheWrite5mTokens * p.cacheWrite5m +
    t.cacheWrite1hTokens * p.cacheWrite1h +
    t.outputTokens * p.output;
  return micro / 1_000_000;
}

export function usageEntry(args: {
  call: string;
  kind: "actor" | "scorer";
  usage: ApiUsage | null | undefined;
  ms: number;
  stopReason: string | null;
  refused: boolean;
}): UsageEntry {
  const t = tokenCounts(args.usage);
  return {
    call: args.call,
    kind: args.kind,
    inputTokens: t.inputTokens,
    cacheReadTokens: t.cacheReadTokens,
    cacheWriteTokens: t.cacheWrite5mTokens + t.cacheWrite1hTokens,
    outputTokens: t.outputTokens,
    costUsd: costUsd(t),
    ms: Math.max(0, Math.round(args.ms)),
    stopReason: args.stopReason,
    refused: args.refused,
  };
}
