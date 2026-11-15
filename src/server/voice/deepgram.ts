/**
 * The two Deepgram calls the game makes. Only the server talks to Deepgram; the key is passed
 * in, sent only in the Authorization header, and never logged or echoed in an error.
 *
 *   Text-to-speech:  POST https://api.deepgram.com/v1/speak?model=<aura voice>&encoding=linear16
 *                    &container=none&sample_rate=24000; body {"text": "..."}. Raw 16-bit PCM
 *                    streams back (audio/l16;rate=24000), ~2x faster than real time. Max 2000 chars.
 *   Speech-to-text:  POST https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true
 *                    &punctuate=true&keyterm=...; raw audio body with its Content-Type.
 * Docs: https://developers.deepgram.com/reference/text-to-speech/speak-request,
 *       https://developers.deepgram.com/reference/speech-to-text/listen-pre-recorded,
 *       https://developers.deepgram.com/docs/keyterm
 */

export const DEEPGRAM_BASE = "https://api.deepgram.com";
let base = DEEPGRAM_BASE;
/** Point at another Deepgram host (the EU endpoint, a proxy, or a local stand-in for tests). */
export function setDeepgramBase(url: string | undefined) {
  base = url?.trim().replace(/\/+$/, "") || DEEPGRAM_BASE;
}
/**
 * Raw PCM, not mp3: the browser schedules it through Web Audio as it arrives, so sound starts at
 * the first byte and sentences join sample-accurately. (Chrome would not start an mp3 in an
 * <audio> element until ~32 KB had arrived, which at Deepgram's pace is two to three seconds.)
 * 24 kHz is Aura's native rate; 48 KB per second of speech.
 */
export const TTS_SAMPLE_RATE = 24000;
export const TTS_FORMAT = `encoding=linear16&container=none&sample_rate=${TTS_SAMPLE_RATE}`;
export const STT_MODEL = "nova-3";

export class DeepgramError extends Error {
  constructor(
    message: string,
    /** Upstream HTTP status, or 0 for a network failure or timeout. */
    readonly upstreamStatus: number,
  ) {
    super(message);
    this.name = "DeepgramError";
  }
}

export type Fetch = typeof fetch;

const describe = async (res: Response) => {
  // Deepgram's error bodies carry err_code/err_msg; they never echo the key, but keep it short.
  const body = await res.text().catch(() => "");
  let msg = "";
  try {
    const j = JSON.parse(body) as { err_msg?: string; message?: string; err_code?: string };
    msg = j.err_msg ?? j.message ?? j.err_code ?? "";
  } catch {
    msg = body.slice(0, 120);
  }
  return `Deepgram ${res.status}${msg ? `: ${msg}` : ""}`;
};

/** Starts a text-to-speech request. Resolves once Deepgram has answered; the body then streams. */
export async function deepgramSpeak(f: Fetch, key: string, voice: string, text: string, timeoutMs = 20_000): Promise<Response> {
  const url = `${base}/v1/speak?model=${encodeURIComponent(voice)}&${TTS_FORMAT}`;
  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new DeepgramError(`Deepgram text-to-speech unreachable (${e instanceof Error ? e.name : "error"}).`, 0);
  }
  if (!res.ok || !res.body) throw new DeepgramError(await describe(res), res.status);
  return res;
}

export interface Transcript {
  transcript: string;
  /** Length of the audio Deepgram processed, in seconds (what it bills). */
  duration: number;
  confidence: number;
  words: number;
}

/** Sends one recorded clip to pre-recorded speech-to-text. */
export async function deepgramListen(
  f: Fetch,
  key: string,
  audio: Uint8Array<ArrayBuffer>,
  contentType: string,
  keyterms: string[],
  timeoutMs = 30_000,
): Promise<Transcript> {
  const q = new URLSearchParams({ model: STT_MODEL, smart_format: "true", punctuate: "true", language: "en" });
  for (const k of keyterms) q.append("keyterm", k);
  let res: Response;
  try {
    res = await f(`${base}/v1/listen?${q}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": contentType },
      body: audio,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new DeepgramError(`Deepgram speech-to-text unreachable (${e instanceof Error ? e.name : "error"}).`, 0);
  }
  if (!res.ok) throw new DeepgramError(await describe(res), res.status);
  const j = (await res.json().catch(() => null)) as {
    metadata?: { duration?: number };
    results?: { channels?: { alternatives?: { transcript?: string; confidence?: number; words?: unknown[] }[] }[] };
  } | null;
  const alt = j?.results?.channels?.[0]?.alternatives?.[0];
  return {
    transcript: (alt?.transcript ?? "").trim(),
    duration: Number(j?.metadata?.duration) || 0,
    confidence: Number(alt?.confidence) || 0,
    words: Array.isArray(alt?.words) ? alt.words.length : 0,
  };
}
