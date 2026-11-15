/**
 * Every tunable of the model layer in one place: model, prices, effort, token limits.
 * Prices are USD per million tokens for claude-opus-5-5 (shared/model-migration.md,
 * "Migrating to Claude Opus 5.5" -> Pricing).
 */

export const MODEL = "claude-opus-5-5";

export const PRICE_PER_MTOK = {
  input: 4, // uncached input
  output: 20, // includes thinking tokens
  cacheRead: 0.2, // 0.05x input
  cacheWrite5m: 5, // 1.25x input, 5-minute TTL (the only TTL this module uses)
  cacheWrite1h: 8, // 2x input, listed for completeness
} as const;

export type Effort = "low" | "medium";

/** Effort for the reply. Actors talk; scorers judge. */
export const ACTOR_EFFORT: Effort = "low";
export const SCORER_EFFORT: Effort = "medium";

/**
 * Top-level `output_config.effort` sent on EVERY call. Changing the top-level effort between
 * requests invalidates the prompt cache, so all roles send the same value (the model default,
 * which the docs say is equivalent to omitting it) and actors lower theirs with a per-message
 * `role: "system"` effort change placed after the cached record. That needs this beta header,
 * which is therefore sent on every call so headers never differ between roles.
 */
export const BASE_EFFORT: Effort = SCORER_EFFORT;
export const PER_MESSAGE_EFFORT_BETA = "mid-conversation-output-config-2026-07-01";

/** Thinking counts toward max_tokens, so these leave room for it as well as the reply. */
export const ACTOR_MAX_TOKENS = 8000;
/** Non-streaming calls: the SDK refuses max_tokens above ~21k without streaming. */
export const SCORER_MAX_TOKENS = 16000;

/**
 * Wall-clock deadline per call, covering the SDK's own retries, so one hung call cannot stall
 * a trial. On expiry an actor resolves refused: true and a scorer resolves null (no retry).
 */
export const ACTOR_TIMEOUT_MS = 60_000;
export const SCORER_TIMEOUT_MS = 90_000;

/** SDK-level retries (429, 5xx, connection errors) before an error reaches this module. */
export const SDK_MAX_RETRIES = 3;

/**
 * An extra cache breakpoint is placed on every RECORD_CHUNK-th record entry, so that a read
 * point exists at a stable position even if many entries are added between two calls
 * (each breakpoint only looks back 20 blocks for an earlier cache entry).
 */
export const RECORD_CHUNK = 16;

/** Minimum cacheable prefix for claude-opus-5-5 (shared/prompt-caching.md). */
export const MIN_CACHEABLE_TOKENS = 512;
