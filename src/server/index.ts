/**
 * Server entry. Dev: `npm run dev:server` (Vite proxies /api here).
 * Production: `npm run build:web && NODE_ENV=production tsx src/server/index.ts` serves web/dist too.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { loadCase } from "../cases/index";
import { createApp } from "./app";
import { TrialHub } from "./hub";
import { llmMode } from "./llmSelect";
import { VoiceService } from "./voice/service";

const port = Number(process.env.PORT) || 8787;
const hostname = process.env.HOST || "127.0.0.1";
const production = process.env.NODE_ENV === "production";

const mode = llmMode();
const hub = new TrialHub(mode, {
  loadCase,
  dataDir: process.env.TRIALS_DIR ? path.resolve(process.env.TRIALS_DIR) : undefined,
});
// The Deepgram key is read here, passed only to the voice service, and never logged.
const voice = new VoiceService({
  apiKey: process.env.DEEPGRAM_API_KEY,
  baseUrl: process.env.DEEPGRAM_API_URL,
  log: process.env.VOICE_LOG === "1",
});
const app = createApp(hub, mode, voice);

if (production) {
  const dist = path.resolve(process.cwd(), "web", "dist");
  if (!existsSync(path.join(dist, "index.html"))) {
    console.warn("[server] web/dist is missing. Run `npm run build:web` first.");
  }
  const root = path.relative(process.cwd(), dist) || ".";
  app.use("/*", serveStatic({ root }));
  app.get("/assets/*", (c) => c.notFound());
  app.get("*", serveStatic({ root, path: "index.html" })); // client-side routes
}

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  const llm =
    mode === "fake"
      ? "fake (FAKE_LLM=1, deterministic, no API calls)"
      : mode === "anthropic"
        ? "Anthropic API"
        : "none: no ANTHROPIC_API_KEY. Add it to .env.local or set FAKE_LLM=1; new trials will return 503";
  const tts = voice.available ? "Deepgram (text-to-speech and dictation)" : "off (no DEEPGRAM_API_KEY; the game stays text-only)";
  console.log(`[server] http://${info.address}:${info.port}  llm: ${llm}  voice: ${tts}${production ? "  (serving web/dist)" : ""}`);
});

const shutdown = () => {
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
