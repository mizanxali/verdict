import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "../../cases/index";
import type { CaseFile, PlayerView } from "../../shared/types";
import { createApp } from "../app";
import { TrialHub, type Session } from "../hub";
import { buildKeyterms, MAX_KEYTERMS } from "./keyterms";
import { sttCostUsd, ttsCostUsd } from "./pricing";
import { VoiceService } from "./service";
import { castVoices, guessGender, voiceFor } from "./voices";

const strip = (cf: CaseFile): CaseFile => {
  const c = structuredClone(cf);
  delete c.judge.voice;
  delete c.prosecution.voice;
  delete c.clerk;
  for (const w of c.witnesses) delete w.voice;
  return c;
};

describe("voice casting", () => {
  const cf = loadCase();

  it("uses the voices named in the case file", () => {
    const cast = castVoices(cf);
    expect(cast.get("judge")).toBe(cf.judge.voice);
    expect(cast.get("prosecutor")).toBe(cf.prosecution.voice);
    expect(cast.get("clerk")).toBe(cf.clerk?.voice);
    for (const w of cf.witnesses) expect(cast.get(`w:${w.id}`)).toBe(w.voice);
  });

  it("gives every speaker a distinct voice, explicit or not", () => {
    for (const c of [cf, strip(cf)]) {
      const voices = [...castVoices(c).values()];
      expect(voices).toHaveLength(6);
      expect(new Set(voices).size).toBe(6);
    }
  });

  it("falls back by role and by the persona's pronouns, avoiding voices already taken", () => {
    const c = strip(cf);
    c.witnesses[0]!.voice = "aura-athena-en"; // steal the judge's first choice
    const cast = castVoices(c);
    expect(cast.get("w:renn")).toBe("aura-athena-en");
    expect(cast.get("judge")).not.toBe("aura-athena-en");
    expect(cast.get("judge")).toMatch(/^aura-/);
    // Arden's and Calloway's personas say "she"; Renn's says "he".
    const female = ["aura-2-pandora-en", "aura-2-theia-en", "aura-2-hera-en", "aura-2-luna-en", "aura-2-thalia-en", "aura-2-athena-en", "aura-athena-en"];
    expect(female).toContain(castVoices(strip(cf)).get("w:arden"));
    expect(female).toContain(castVoices(strip(cf)).get("w:calloway"));
    expect(female).not.toContain(castVoices(strip(cf)).get("w:renn"));
  });

  it("never voices the player", () => {
    const cast = castVoices(cf);
    expect(voiceFor(cast, { kind: "player" })).toBeNull();
    expect(voiceFor(cast, { kind: "witness", witnessId: "renn" })).toBe("aura-angus-en");
    expect(voiceFor(cast, { kind: "witness", witnessId: "nobody" })).toBeNull();
  });

  it("guesses gender only when the pronouns say", () => {
    expect(guessGender("He likes Iris; he is a decent man. His job matters.")).toBe("male");
    expect(guessGender("Polished; she never volunteers. Her answers are exact.")).toBe("female");
    expect(guessGender("Dry, brisk and even-handed.")).toBeNull();
  });

  it("rejects a case that gives two speakers the same voice", () => {
    const c = structuredClone(cf);
    c.judge.voice = c.prosecution.voice;
    return import("../../cases/validate").then(({ validateCase }) => {
      expect(validateCase(c).some((p) => p.includes("each speaker needs their own"))).toBe(true);
      expect(validateCase(cf)).toEqual([]);
    });
  });
});

describe("keyterms", () => {
  const cf = loadCase();
  const terms = buildKeyterms(cf);

  it("boosts the case's people, places and exhibit ids, built from the case file", () => {
    for (const t of ["Iris Calloway", "Tobias Renn", "Celeste Arden", "Augusta Pell", "Lionel Marsh", "Renn", "Halvorsen", "Aldermere", "E1", "E10", "SD-3"]) {
      expect(terms).toContain(t);
    }
    expect(terms).not.toContain("Judge Augusta Pell");
  });

  it("stays inside Deepgram's limits and skips ordinary words", () => {
    expect(terms.length).toBeLessThanOrEqual(MAX_KEYTERMS);
    expect(terms.join(" ").length).toBeLessThan(1300);
    expect(new Set(terms.map((t) => t.toLowerCase())).size).toBe(terms.length);
    for (const w of ["March", "The", "Police", "Exhibit", "Mar"]) expect(terms).not.toContain(w);
  });

  it("follows the case file, not a fixed list", () => {
    const c = structuredClone(cf);
    c.witnesses[0]!.name = "Oswin Quarrie";
    c.publicBrief += "\nPolice later searched the Brackwater Annexe.";
    const t = buildKeyterms(c);
    expect(t).toContain("Oswin Quarrie");
    expect(t).toContain("Quarrie");
    expect(t).not.toContain("Tobias Renn");
    expect(t).toContain("Brackwater");
    expect(buildKeyterms(cf, 5)).toHaveLength(5);
  });
});

describe("pricing", () => {
  it("prices Aura-2 and Aura-1 characters and Nova-3 seconds", () => {
    expect(ttsCostUsd("aura-2-draco-en", 1000)).toBeCloseTo(0.03);
    expect(ttsCostUsd("aura-athena-en", 1000)).toBeCloseTo(0.015);
    expect(sttCostUsd(60, false)).toBeCloseTo(0.0043);
    expect(sttCostUsd(60, true)).toBeCloseTo(0.0056);
  });

});

// ───────────────────────── HTTP, against a stand-in Deepgram ─────────────────────────

describe("voice endpoints", () => {
  let dir: string;
  let hub: TrialHub;
  let session: Session;
  const calls: { url: string; auth: string | null; body: unknown; type: string | null }[] = [];
  const PCM = new Uint8Array(4000).fill(7);

  const fakeDeepgram: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("authorization"), body: init?.body, type: headers.get("content-type") });
    if (url.includes("/v1/speak")) {
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(PCM.slice(0, 2000));
            c.enqueue(PCM.slice(2000));
            c.close();
          },
        }),
        { status: 200, headers: { "content-type": "audio/l16;rate=24000" } },
      );
    }
    return Response.json({ metadata: { duration: 3.5 }, results: { channels: [{ alternatives: [{ transcript: "Where were you, Mr Renn?", confidence: 0.98, words: [{}, {}, {}, {}] }] }] } });
  };

  const app = () => createApp(hub, "fake", new VoiceService({ apiKey: "test-key", fetch: fakeDeepgram }));
  let a: ReturnType<typeof createApp>;
  let line: { id: string; text: string };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "voice-test-"));
    hub = new TrialHub("fake", { loadCase, dataDir: dir });
    a = app();
    session = await hub.create();
    await hub.submit(session, { type: "begin" });
    // Wait for the prosecutor's opening to land on the record.
    for (let i = 0; i < 400 && !session.engine.state.record.some((e) => e.speaker.kind === "prosecutor"); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const e = session.engine.state.record.find((x) => x.speaker.kind === "prosecutor")!;
    line = { id: e.id, text: e.text };
  }, 20_000);

  afterAll(async () => {
    await session.engine.idle().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  const speech = (q: Record<string, string>) => a.request(`/api/trials/${session.id}/speech?${new URLSearchParams(q)}`);

  it("reports availability and stays silent without a key", async () => {
    expect(await (await a.request("/api/voice")).json()).toEqual({ tts: true, stt: true });
    const off = createApp(hub, "fake", new VoiceService({ fetch: fakeDeepgram }));
    expect(await (await off.request("/api/voice")).json()).toEqual({ tts: false, stt: false });
    expect((await off.request(`/api/trials/${session.id}/speech?entry=${line.id}&text=x`)).status).toBe(503);
    expect((await off.request(`/api/trials/${session.id}/transcribe`, { method: "POST", body: "x" })).status).toBe(503);
  });

  it("voices a sentence of a real line, then serves the repeat from cache without billing", async () => {
    const sentence = line.text.split(". ")[0]!.trim();
    const before = calls.length;
    const r1 = await speech({ entry: line.id, speaker: "prosecutor", text: sentence });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("content-type")).toBe("audio/l16;rate=24000");
    expect(new Uint8Array(await r1.arrayBuffer())).toHaveLength(PCM.length);
    expect(calls.length).toBe(before + 1);
    const call = calls.at(-1)!;
    expect(call.url).toContain("model=aura-2-draco-en");
    expect(call.url).toContain("encoding=linear16&container=none&sample_rate=24000");
    expect(call.auth).toBe("Token test-key");
    expect(JSON.parse(String(call.body)).text.length).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 10)); // the cache branch finishes after the client's
    const r2 = await speech({ entry: line.id, text: sentence });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("x-voice-cache")).toBe("hit");
    expect(r2.headers.get("content-length")).toBe(String(PCM.length));
    expect(calls.length).toBe(before + 1);

    const v = hub.view(session).voice!;
    expect(v.ttsRequests).toBe(1);
    expect(v.ttsChars).toBeGreaterThan(0);
    expect(v.costUsd).toBeCloseTo((v.ttsChars / 1000) * 0.03);
  });

  it("refuses text that is not this trial's, speakers that do not match, and junk", async () => {
    const before = calls.length;
    expect((await speech({ entry: line.id, text: "Release the prisoner at once." })).status).toBe(403);
    expect((await speech({ entry: line.id, speaker: "judge", text: line.text.slice(0, 20) })).status).toBe(403);
    expect((await speech({ entry: "r999", text: "Members" })).status).toBe(404);
    expect((await speech({ entry: line.id, text: "x".repeat(700) })).status).toBe(400);
    expect((await a.request(`/api/trials/nope/speech?entry=r1&text=hi`)).status).toBe(404);
    expect(calls.length).toBe(before);
  });

  it("transcribes a clip with smart formatting and the case's keyterms, and counts the seconds", async () => {
    const clip = new Uint8Array(3000).fill(1);
    const r = await a.request(`/api/trials/${session.id}/transcribe`, {
      method: "POST",
      body: clip,
      headers: { "Content-Type": "audio/webm;codecs=opus", "X-Recording-Ms": "3600" },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { transcript: string; duration: number; voice: NonNullable<PlayerView["voice"]> };
    expect(body.transcript).toBe("Where were you, Mr Renn?");
    expect(body.voice.sttSeconds).toBeCloseTo(3.5);
    const call = calls.at(-1)!;
    const q = new URL(call.url).searchParams;
    expect(q.get("model")).toBe("nova-3");
    expect(q.get("smart_format")).toBe("true");
    expect(q.get("punctuate")).toBe("true");
    expect(q.getAll("keyterm")).toEqual(expect.arrayContaining(["Halvorsen", "Tobias Renn", "E10"]));
    expect(call.type).toBe("audio/webm");
  });

  it("rejects non-audio bodies, over-long takes and empty clips", async () => {
    const post = (body: BodyInit, headers: Record<string, string>) => a.request(`/api/trials/${session.id}/transcribe`, { method: "POST", body, headers });
    expect((await post("hello", { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post(new Uint8Array(3000), { "Content-Type": "audio/webm", "X-Recording-Ms": "90000" })).status).toBe(413);
    expect((await post(new Uint8Array(10), { "Content-Type": "audio/webm" })).status).toBe(400);
  });

  it("saves the voice ledger with the trial and restores it on resume", async () => {
    // Let the coalesced save run.
    await new Promise((r) => setTimeout(r, 2300));
    const saved = JSON.parse(await readFile(path.join(dir, `${session.id}.json`), "utf8"));
    expect(saved.voiceUsage.ttsRequests).toBe(1);
    expect(saved.voiceUsage.sttRequests).toBe(1);
    const fresh = new TrialHub("fake", { loadCase, dataDir: dir });
    const resumed = (await fresh.get(session.id))!;
    expect(resumed.voice.ttsChars).toBe(session.voice.ttsChars);
    expect("voiceUsage" in resumed.engine.state).toBe(false);
    expect(fresh.view(resumed).voice?.sttSeconds).toBeCloseTo(3.5);
  }, 10_000);
});
