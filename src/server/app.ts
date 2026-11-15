/**
 * HTTP + SSE surface for web/.
 *   POST /api/trials                 -> { trialId, view }
 *   GET  /api/trials/:id             -> { view }
 *   GET  /api/trials/:id/events      -> SSE stream of TrialEvent JSON
 *   POST /api/trials/:id/actions     -> 202 | 400 | 404 | 409 | 503
 * Voice (text-to-speech, speech-to-text): see voice/routes.ts.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { TrialEvent } from "../shared/types";
import { parseAction } from "./actions";
import { isTrialId, TrialHub } from "./hub";
import { MISSING_KEY_MESSAGE, type LlmMode } from "./llmSelect";
import { voiceRoutes } from "./voice/routes";
import { VoiceService } from "./voice/service";

const KEEP_ALIVE_MS = 15_000;

export function createApp(hub: TrialHub, mode: LlmMode, voice: VoiceService = new VoiceService()) {
  const app = new Hono();

  app.onError((err, c) => {
    console.error(`[http] ${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json({ error: "Internal server error." }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, llm: mode }));

  app.post("/api/trials", async (c) => {
    if (mode === "missing_key") return c.json({ error: MISSING_KEY_MESSAGE }, 503);
    const s = await hub.create();
    return c.json({ trialId: s.id, view: hub.view(s) }, 201);
  });

  app.get("/api/trials/:id", async (c) => {
    const s = await hub.get(c.req.param("id"));
    if (!s) return c.json({ error: "No such trial." }, 404);
    return c.json({ view: hub.view(s) });
  });

  app.get("/api/trials/:id/events", async (c) => {
    const s = await hub.get(c.req.param("id"));
    if (!s) return c.json({ error: "No such trial." }, 404);
    c.header("Cache-Control", "no-cache, no-transform");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      // Writes are chained so events reach this client in emission order.
      let chain: Promise<unknown> = stream.writeSSE({ data: "", event: "hello", retry: 2000 });
      const enqueue = (write: () => Promise<unknown>) => {
        chain = chain.then(write).catch(() => undefined);
      };
      const send = (event: TrialEvent) => enqueue(() => stream.writeSSE({ data: JSON.stringify(event) }));
      const unsubscribe = hub.subscribe(s, send);
      const keepAlive = setInterval(() => enqueue(() => stream.write(": keep-alive\n\n")), KEEP_ALIVE_MS);
      await new Promise<void>((resolve) => {
        if (stream.aborted) return resolve();
        stream.onAbort(resolve);
      });
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.post(
    "/api/trials/:id/actions",
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: "Request body too large." }, 413) }),
    async (c) => {
      const id = c.req.param("id");
      if (!isTrialId(id)) return c.json({ error: "No such trial." }, 404);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Body must be JSON." }, 400);
      }
      const parsed = parseAction(body);
      if (!parsed.ok) return c.json({ error: parsed.message }, 400);
      if (mode === "missing_key") return c.json({ error: MISSING_KEY_MESSAGE }, 503);
      const s = await hub.get(id);
      if (!s) return c.json({ error: "No such trial." }, 404);
      const r = await hub.submit(s, parsed.action);
      if (r.status === 202) return c.json({ accepted: true }, 202);
      return c.json({ error: r.message }, r.status);
    },
  );

  voiceRoutes(app, hub, voice);

  app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

  return app;
}
