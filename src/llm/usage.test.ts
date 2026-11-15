import { describe, expect, it } from "vitest";
import { PRICE_PER_MTOK } from "./constants";
import { costUsd, tokenCounts, usageEntry } from "./usage";

describe("cost maths", () => {
  it("prices each token class at its own rate", () => {
    expect(PRICE_PER_MTOK).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 });
    const one = (k: keyof ReturnType<typeof tokenCounts>) => ({ inputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 0, [k]: 1_000_000 });
    expect(costUsd(one("inputTokens"))).toBeCloseTo(4);
    expect(costUsd(one("outputTokens"))).toBeCloseTo(20);
    expect(costUsd(one("cacheReadTokens"))).toBeCloseTo(0.2);
    expect(costUsd(one("cacheWrite5mTokens"))).toBeCloseTo(5);
    expect(costUsd(one("cacheWrite1hTokens"))).toBeCloseTo(8);
  });

  it("builds a UsageEntry from an API usage object", () => {
    const e = usageEntry({
      call: "scorer:jury",
      kind: "scorer",
      usage: { input_tokens: 300, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1200, output_tokens: 450 },
      ms: 1234.4,
      stopReason: "end_turn",
      refused: false,
    });
    // 300*4 + 5000*0.2 + 1200*5 + 450*20 = 1200 + 1000 + 6000 + 9000 = 17200 micro-dollars
    expect(e.costUsd).toBeCloseTo(0.0172, 10);
    expect(e).toMatchObject({ inputTokens: 300, cacheReadTokens: 5000, cacheWriteTokens: 1200, outputTokens: 450, ms: 1234, stopReason: "end_turn", refused: false });
  });

  it("uses the TTL breakdown when present and tolerates missing usage", () => {
    const t = tokenCounts({ cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 400 } });
    expect(t).toMatchObject({ cacheWrite5mTokens: 600, cacheWrite1hTokens: 400 });
    expect(costUsd(t)).toBeCloseTo((600 * 5 + 400 * 8) / 1e6, 12);
    const empty = usageEntry({ call: "actor:judge", kind: "actor", usage: null, ms: 5, stopReason: null, refused: true });
    expect(empty).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: 0, refused: true });
  });
});
