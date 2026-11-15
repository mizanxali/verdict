/**
 * Voice endpoints. All Deepgram traffic goes through here; the browser never sees the key.
 *
 *   GET  /api/voice                    -> { tts, stt }  (always 200, so a keyless server is quiet)
 *   GET  /api/trials/:id/speech?entry=r12&speaker=w:renn&text=...  -> audio/l16;rate=24000,
 *        streamed as Deepgram produces it
 *        204 nothing speakable | 400 | 403 not this trial's line or an unvoiced speaker
 *        404 | 413 | 429 voice budget spent | 502 Deepgram failed | 503 no key
 *   POST /api/trials/:id/transcribe    raw audio body (Content-Type passed through),
 *        X-Recording-Ms header -> { transcript, duration, voice }
 *        400 | 404 | 413 too long or too big | 415 | 429 | 502 | 503
 * Voice spend rides on state events (coalesced, see TrialHub.recordVoice); transcribe also
 * returns it in the body.
 */
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { cleanForSpeech, MAX_SPEECH_CHARS } from "../../shared/speech";
import { isTrialId, type Session, type TrialHub } from "../hub";
import { buildKeyterms } from "./keyterms";
import { sttCostUsd, ttsCostUsd } from "./pricing";
import { DeepgramError, type VoiceService } from "./service";
import { castVoices, speakerVoiceKey, voiceFor } from "./voices";

/** Push-to-talk takes are capped in the browser at 60 s; allow a little slack. */
export const MAX_RECORDING_MS = 65_000;
/** Opus in webm runs ~4-8 KB/s and AAC in mp4 ~16 KB/s; 2 MB covers a minute of either. */
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
/** Per-trial ceilings, so a runaway client cannot run up a bill. A whole trial is ~15-25k chars. */
export const MAX_TTS_CHARS_PER_TRIAL = 120_000;
export const MAX_STT_SECONDS_PER_TRIAL = 30 * 60;

const NO_KEY = "Voice is not configured on this server (no DEEPGRAM_API_KEY).";

const SpeechQuery = z.object({
  entryId: z.string().regex(/^r\d{1,5}$/),
  speaker: z.string().max(80).optional(),
  text: z.string().transform((t) => t.trim()).pipe(z.string().min(1).max(MAX_SPEECH_CHARS)),
});

const AUDIO_TYPE = /^(audio|video)\/[a-z0-9.+-]+$/;

export function voiceRoutes(app: Hono, hub: TrialHub, voice: VoiceService) {
  // Per-trial derived data: who sounds like whom, and the words to boost in transcription.
  const derived = new WeakMap<Session, { cast: Map<string, string>; keyterms: string[] }>();
  const derive = (s: Session) => {
    let d = derived.get(s);
    if (!d) {
      d = { cast: castVoices(s.caseFile), keyterms: buildKeyterms(s.caseFile) };
      derived.set(s, d);
    }
    return d;
  };

  const failure = (e: unknown, what: string, trialId: string) => {
    const status = e instanceof DeepgramError ? e.upstreamStatus : 0;
    console.error(`[voice] ${what} failed for ${trialId}: ${e instanceof Error ? e.message : String(e)}`);
    return status === 429 ? 429 : 502;
  };

  app.get("/api/voice", (c) => c.json({ tts: voice.available, stt: voice.available }));

  // Streamed straight through, so the browser can start playing at Deepgram's first byte
  // instead of after the whole sentence is synthesised (Aura runs only ~2x faster than real time).
  app.get("/api/trials/:id/speech", async (c) => {
    if (!voice.available) return c.json({ error: NO_KEY }, 503);
    const id = c.req.param("id");
    if (!isTrialId(id)) return c.json({ error: "No such trial." }, 404);
    const parsed = SpeechQuery.safeParse({ entryId: c.req.query("entry"), speaker: c.req.query("speaker"), text: c.req.query("text") ?? "" });
    if (!parsed.success) return c.json({ error: `Expected ?entry=&text= with 1-${MAX_SPEECH_CHARS} characters of text.` }, 400);
    const s = await hub.get(id);
    if (!s) return c.json({ error: "No such trial." }, 404);

    const { entryId, speaker, text } = parsed.data;
    const line = hub.line(s, entryId);
    if (!line) return c.json({ error: "No such line in this trial." }, 404);
    const key = speakerVoiceKey(line.speaker);
    const voiceId = voiceFor(derive(s).cast, line.speaker);
    if (!key || !voiceId) return c.json({ error: "That speaker is not voiced." }, 403);
    if (speaker !== undefined && speaker !== key) return c.json({ error: "That line belongs to a different speaker." }, 403);
    if (!line.text.includes(text)) return c.json({ error: "That text is not part of this line." }, 403);

    const spoken = cleanForSpeech(text);
    if (!spoken) return c.body(null, 204);
    if (s.voice.ttsChars + spoken.length > MAX_TTS_CHARS_PER_TRIAL) {
      return c.json({ error: "This trial's voice budget is spent." }, 429);
    }

    let r;
    try {
      r = await voice.speak(voiceId, spoken);
    } catch (e) {
      return c.json({ error: "The voice service failed." }, failure(e, "speech", s.id));
    }
    if (r.billed) hub.recordVoice(s, { ttsChars: spoken.length, ttsRequests: 1, costUsd: ttsCostUsd(voiceId, spoken.length) });
    const headers: Record<string, string> = {
      "Content-Type": r.type,
      "Cache-Control": "private, max-age=3600",
      "X-Voice-Cache": r.billed ? "miss" : "hit",
    };
    if (r.body instanceof Uint8Array) headers["Content-Length"] = String(r.body.length);
    return new Response(r.body, { status: 200, headers });
  });

  app.post(
    "/api/trials/:id/transcribe",
    bodyLimit({ maxSize: MAX_AUDIO_BYTES, onError: (c) => c.json({ error: "That recording is too large." }, 413) }),
    async (c) => {
      if (!voice.available) return c.json({ error: NO_KEY }, 503);
      const id = c.req.param("id");
      if (!isTrialId(id)) return c.json({ error: "No such trial." }, 404);
      const type = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!AUDIO_TYPE.test(type)) return c.json({ error: "Send the recording as an audio/* body." }, 415);
      const claimedMs = Number(c.req.header("x-recording-ms"));
      if (Number.isFinite(claimedMs) && claimedMs > MAX_RECORDING_MS) return c.json({ error: "That recording is too long (60 seconds at most)." }, 413);
      const s = await hub.get(id);
      if (!s) return c.json({ error: "No such trial." }, 404);
      if (s.voice.sttSeconds >= MAX_STT_SECONDS_PER_TRIAL) return c.json({ error: "This trial's dictation budget is spent." }, 429);

      const audio = new Uint8Array(await c.req.arrayBuffer());
      if (audio.length < 256) return c.json({ error: "That recording is empty." }, 400);

      const { keyterms } = derive(s);
      let t;
      try {
        t = await voice.transcribe(audio, type, keyterms);
      } catch (e) {
        return c.json({ error: "The transcription service failed." }, failure(e, "transcription", s.id));
      }
      const seconds = t.duration || (Number.isFinite(claimedMs) ? claimedMs / 1000 : 0);
      if (seconds > MAX_RECORDING_MS / 1000 + 5) console.warn(`[voice] ${s.id}: a ${seconds.toFixed(1)} s clip got past the length cap`);
      const usage = hub.recordVoice(s, { sttSeconds: seconds, sttRequests: 1, costUsd: sttCostUsd(seconds, keyterms.length > 0) });
      return c.json({ transcript: t.transcript, duration: seconds, voice: usage });
    },
  );
}
