/**
 * Deepgram list prices, pay-as-you-go tier, in US dollars.
 * Source: https://deepgram.com/pricing (checked 2026-11-15). Update here if the rates change;
 * nothing else in the code base hard-codes a voice price.
 *
 *   Text-to-speech, per 1,000 characters:  Aura-2 $0.030   Aura-1 $0.015
 *   Speech-to-text, Nova-3 pre-recorded (monolingual), per minute: $0.0043
 *   Keyterm prompting add-on, per minute: $0.0013
 *   Speech-to-text is billed per second with no rounding up to blocks.
 */

export const TTS_USD_PER_1K_CHARS = { "aura-2": 0.03, "aura-1": 0.015 } as const;
export const STT_NOVA3_USD_PER_MIN = 0.0043;
export const STT_KEYTERM_USD_PER_MIN = 0.0013;

/** Aura-2 ids are "aura-2-<name>-<lang>"; everything else on /v1/speak is Aura-1. */
export function ttsGeneration(voice: string): keyof typeof TTS_USD_PER_1K_CHARS {
  return voice.startsWith("aura-2-") ? "aura-2" : "aura-1";
}

export function ttsCostUsd(voice: string, chars: number): number {
  return (chars / 1000) * TTS_USD_PER_1K_CHARS[ttsGeneration(voice)];
}

export function sttCostUsd(seconds: number, withKeyterms: boolean): number {
  return (seconds / 60) * (STT_NOVA3_USD_PER_MIN + (withKeyterms ? STT_KEYTERM_USD_PER_MIN : 0));
}
