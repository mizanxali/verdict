/**
 * Server-side voice: Deepgram text-to-speech with an in-memory cache, and speech-to-text.
 * One instance per server. Without an API key it reports unavailable and makes no calls.
 */
import { deepgramListen, deepgramSpeak, DeepgramError, setDeepgramBase, type Fetch, type Transcript } from "./deepgram";

export { DeepgramError };

type Bytes = Uint8Array<ArrayBuffer>;

interface Clip {
  bytes: Bytes;
  type: string;
}

export interface SpeakResult {
  /** A live stream from Deepgram (billed) or cached bytes (free). */
  body: ReadableStream<Uint8Array> | Bytes;
  type: string;
  billed: boolean;
}

export interface VoiceServiceOptions {
  apiKey?: string;
  fetch?: Fetch;
  /** Cap on cached audio. PCM runs 48 KB per second of speech: a sentence is 150-400 KB and a
   *  whole trial's lines about 60-70 MB, so the default holds roughly two trials. */
  cacheBytes?: number;
  /** Deepgram allows 15 concurrent REST text-to-speech requests per project on pay-as-you-go. */
  maxConcurrent?: number;
  /** Another Deepgram host, e.g. https://api.eu.deepgram.com. */
  baseUrl?: string;
  /** Log one line per billable Deepgram call (voice, size, timing; never text or key). */
  log?: boolean;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Bytes> {
  const parts: Uint8Array[] = [];
  let n = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export class VoiceService {
  private readonly key: string | null;
  private readonly f: Fetch;
  private readonly cacheCap: number;
  private readonly maxConcurrent: number;
  private cache = new Map<string, Clip>(); // insertion order = least recently used first
  private cached = 0;
  private pending = new Map<string, Promise<Clip | null>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private readonly log: boolean;

  constructor(opts: VoiceServiceOptions = {}) {
    this.key = opts.apiKey?.trim() || null;
    this.f = opts.fetch ?? fetch;
    this.cacheCap = opts.cacheBytes ?? 160 * 1024 * 1024;
    this.maxConcurrent = opts.maxConcurrent ?? 8;
    this.log = !!opts.log;
    if (opts.baseUrl) setDeepgramBase(opts.baseUrl);
  }

  get available(): boolean {
    return this.key !== null;
  }

  /**
   * Audio for `text` in `voice`. Identical requests share one Deepgram call and the cache.
   * A fresh clip streams as Deepgram produces it.
   */
  async speak(voice: string, text: string): Promise<SpeakResult> {
    const k = `${voice}\n${text}`;
    const hit = this.lookup(k);
    if (hit) return { body: hit.bytes, type: hit.type, billed: false };
    const inFlight = this.pending.get(k);
    if (inFlight) {
      const clip = await inFlight;
      if (clip) return { body: clip.bytes, type: clip.type, billed: false };
    }
    if (!this.key) throw new DeepgramError("Voice is not configured.", 0);

    await this.acquire();
    let res: Response;
    const t0 = performance.now();
    try {
      res = await deepgramSpeak(this.f, this.key, voice, text);
    } catch (e) {
      this.release();
      throw e;
    }
    const t1 = performance.now();
    const type = res.headers.get("content-type") || "audio/mpeg";
    // One branch streams to the browser; the other fills the cache. If the browser hangs up,
    // the cache branch still completes, so audio already paid for is never thrown away.
    const [toClient, toCache] = res.body!.tee();
    const filled = collect(toCache)
      .then((bytes): Clip | null => {
        if (this.log) {
          console.log(`[voice] tts ${voice} ${text.length} chars -> ${bytes.length} bytes, first byte ${Math.round(t1 - t0)} ms, done ${Math.round(performance.now() - t0)} ms`);
        }
        if (bytes.length === 0) return null;
        const clip = { bytes, type };
        this.store(k, clip);
        return clip;
      })
      .catch(() => null)
      .finally(() => {
        this.release();
        this.pending.delete(k);
      });
    this.pending.set(k, filled);
    return { body: toClient, type, billed: true };
  }

  async transcribe(audio: Bytes, contentType: string, keyterms: string[]): Promise<Transcript> {
    if (!this.key) throw new DeepgramError("Voice is not configured.", 0);
    const t0 = performance.now();
    const t = await deepgramListen(this.f, this.key, audio, contentType, keyterms);
    if (this.log) console.log(`[voice] stt ${contentType} ${audio.length} bytes, ${t.duration.toFixed(2)} s audio, ${t.words} words, ${Math.round(performance.now() - t0)} ms`);
    return t;
  }

  // ───────────── cache ─────────────

  private lookup(k: string): Clip | undefined {
    const clip = this.cache.get(k);
    if (clip) {
      this.cache.delete(k);
      this.cache.set(k, clip);
    }
    return clip;
  }

  private store(k: string, clip: Clip) {
    if (clip.bytes.length > this.cacheCap) return;
    this.cache.set(k, clip);
    this.cached += clip.bytes.length;
    for (const [old, c] of this.cache) {
      if (this.cached <= this.cacheCap) break;
      this.cache.delete(old);
      this.cached -= c.bytes.length;
    }
  }

  // ───────────── concurrency ─────────────

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(() => resolve()));
  }

  private release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}
