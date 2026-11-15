/**
 * Picks the model layer. One Llm instance per trial, because the engine sets llm.onUsage.
 * The API key is read from the environment and never logged.
 */
import type { Llm } from "../shared/contracts";
import { createFakeLlm } from "../shared/fakeLlm";
import { createLlm } from "../llm/index";

export type LlmMode = "fake" | "anthropic" | "missing_key";

export const MISSING_KEY_MESSAGE =
  "No ANTHROPIC_API_KEY is configured. Add it to .env.local (ANTHROPIC_API_KEY=...) and restart the server, " +
  "or set FAKE_LLM=1 to play against the free deterministic stand-in.";

export function llmMode(env: NodeJS.ProcessEnv = process.env): LlmMode {
  const fake = env.FAKE_LLM?.trim().toLowerCase();
  if (fake && fake !== "0" && fake !== "false") return "fake";
  if (env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  return "missing_key";
}

export function makeLlm(mode: LlmMode): Llm {
  if (mode === "fake") return createFakeLlm({ tokenDelayMs: 15 });
  if (mode === "anthropic") return createLlm({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
  return unavailableLlm();
}

/** Lets a saved trial be loaded and viewed without a key; any model call fails loudly. */
function unavailableLlm(): Llm {
  const fail = async (): Promise<never> => {
    throw new Error(MISSING_KEY_MESSAGE);
  };
  return {
    actor: fail,
    factCheck: fail,
    ruleCheck: fail,
    ruling: fail,
    confront: fail,
    juryUpdate: fail,
    leakCheck: fail,
  };
}
