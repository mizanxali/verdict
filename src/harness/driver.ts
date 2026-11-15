/**
 * Headless full trial from a script file.
 *
 *   npm run trial -- [--fake] [--script <name|path>] [--out <path>]
 *                    [--direct N] [--cross N] [--client N] [--no-markers] [--quiet]
 *
 * --fake         use the deterministic fake model (free); the script's fakeMarkers are injected
 * --script       a name in src/harness/scripts (default full-win) or a path
 * --out          where to save the final TrialState JSON (default data/runs/<timestamp>.json)
 * --direct/--cross/--client   budget overrides (else the script's, else the engine defaults)
 * --no-markers   in fake mode, do not inject fakeMarkers
 * --quiet        no live progress on stderr
 *
 * Without --fake this makes real API calls (ANTHROPIC_API_KEY); the estimate is printed first.
 */
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadCase } from "../cases/index";
import { defaultIo, intFlag, runIfMain, type Io } from "./cli";
import { estimateTrial, formatEstimate } from "./estimate";
import { formatOutcome, formatTranscript, formatUsage, speakerName, summarizeUsage } from "./report";
import { hasApiKey, newLlm, runTrial, saveJson, stamp } from "./runner";
import { DEFAULT_SCRIPT, PROJECT_ROOT, loadScript, scriptBudgets, type BudgetFlags } from "./script";

/** Runs the driver; returns the process exit code. */
export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      fake: { type: "boolean", default: false },
      script: { type: "string" },
      out: { type: "string" },
      direct: { type: "string" },
      cross: { type: "string" },
      client: { type: "string" },
      "no-markers": { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
    },
    strict: true,
  });

  const caseFile = loadCase();
  const script = loadScript(values.script ?? DEFAULT_SCRIPT, caseFile);
  const flags: BudgetFlags = {
    direct: intFlag("direct", values.direct),
    cross: intFlag("cross", values.cross),
    client: intFlag("client", values.client),
  };
  const budgets = scriptBudgets(script, flags);
  const fake = values.fake;
  const est = estimateTrial(script, caseFile, budgets);

  io.err(`script ${script.name} | ${fake ? "FAKE model" : "REAL model"} | budgets direct ${budgets.directQuestions}, cross ${budgets.crossQuestions}, client ${budgets.clientCrossQuestions}`);
  io.err(formatEstimate("estimate", est));
  if (!fake && !hasApiKey()) {
    io.err("ANTHROPIC_API_KEY is not set (put it in .env.local), or pass --fake.");
    return 1;
  }

  const res = await runTrial({
    caseFile,
    llm: newLlm(fake),
    script,
    budgets,
    injectMarkers: fake && !values["no-markers"],
    onEvent: (e) => {
      if (values.quiet) return;
      if (e.type === "entry_end") io.err(`  [${e.entry.id}] ${speakerName(caseFile, e.entry.speaker)} ${e.entry.kind}: ${oneLine(e.entry.text)}`);
      if (e.type === "notice") io.err(`  (notice) ${e.text}`);
      if (e.type === "error") io.err(`  (error) ${e.message}`);
    },
  });

  const s = res.state;
  io.out(formatTranscript(s, caseFile));
  io.out("");
  io.out(formatOutcome(s, caseFile));
  io.out("");
  io.out(formatUsage(summarizeUsage(s.usage, res.wallMs)));
  const run: string[] = [`actions ${res.actions}, re-asks after refusal ${res.reasks}`];
  for (const a of res.abandoned) run.push(`abandoned after refusals: ${a.witnessId}[${a.index}] ${oneLine(a.text)}`);
  for (const u of res.unasked) run.push(`not asked (budget): ${u.witnessId}[${u.index}] ${oneLine(u.text)}`);
  for (const r of res.rejected) run.push(`rejected by engine: ${r}`);
  for (const e of res.errors) run.push(`engine error: ${e}`);
  io.out(["", "=== RUN ===", ...run].join("\n"));

  const out = values.out ? resolve(values.out) : join(PROJECT_ROOT, "data", "runs", `${stamp()}.json`);
  saveJson(out, s);
  io.out(`\nsaved state to ${out}`);
  return s.verdict ? 0 : 1;
}

const oneLine = (t: string, n = 140) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
};

runIfMain(import.meta.url, main);
