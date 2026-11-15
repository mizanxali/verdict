/**
 * Regression check: plays bluff, invented and real, then the jury consistency replay.
 *
 *   npm run regress -- [--fake] [--only bluff,invented,real,consistency] [--runs N]
 *                      [--reuse <dir>] [--yes]
 *
 * --fake    deterministic fake model, scripts' fakeMarkers injected (free)
 * --only    comma-separated subset; consistency needs a real run (played if not reused)
 * --runs    consistency replays of every stored jury call (default 3)
 * --reuse   re-check saved states (<dir>/<name>.json from an earlier regress) without replaying
 * --yes     required for a real run; without it the call estimate is printed and nothing runs
 *
 * Writes every played state and report.json to data/regress/<timestamp>/. Exit code: 0 all
 * pass, 1 any failure, 2 real run not confirmed (estimate only).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadCase } from "../cases/index";
import type { CaseFile, TrialState, UsageEntry } from "../shared/types";
import { checkBluff, checkConsistency, checkInvented, checkReal, type CheckResult } from "./checks";
import { defaultIo, intFlag, runIfMain, type Io } from "./cli";
import { ESTIMATE_ASSUMPTIONS, estimateTrial, formatEstimate } from "./estimate";
import { summarizeUsage } from "./report";
import { hasApiKey, newLlm, runTrial, saveJson, stamp } from "./runner";
import { PROJECT_ROOT, loadScript, scriptBudgets, type Script } from "./script";

export const CHECKS = ["bluff", "invented", "real", "consistency"] as const;
export type CheckName = (typeof CHECKS)[number];
type TrialName = Exclude<CheckName, "consistency">;

interface Played {
  state: TrialState;
  wallMs: number;
  file: string | null;
}

export async function main(argv: string[], io: Io = defaultIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      fake: { type: "boolean", default: false },
      only: { type: "string" },
      runs: { type: "string" },
      reuse: { type: "string" },
      yes: { type: "boolean", default: false },
      "out-dir": { type: "string" },
    },
    strict: true,
  });
  const fake = values.fake;
  const runs = intFlag("runs", values.runs) ?? 3;
  const selected = parseOnly(values.only);
  const trials: TrialName[] = (["bluff", "invented", "real"] as const).filter(
    (t) => selected.includes(t) || (t === "real" && selected.includes("consistency")),
  );

  const caseFile = loadCase();
  const scripts = Object.fromEntries(trials.map((t) => [t, loadScript(t, caseFile)])) as Record<TrialName, Script>;
  const reuseDir = values.reuse ? resolve(values.reuse) : null;
  const reused: Partial<Record<TrialName, TrialState>> = {};
  if (reuseDir) for (const t of trials) reused[t] = loadState(join(reuseDir, `${t}.json`), caseFile);

  // ── Estimate (always printed; gates real runs) ──
  const est = estimateRegression(trials, selected, scripts, caseFile, runs, reused);
  io.out(est.text);
  if (!fake && !values.yes) {
    io.out("\nReal API run not started. Re-run with --yes to spend the calls above, or use --fake.");
    return 2;
  }
  if (!fake && !hasApiKey()) {
    io.err("ANTHROPIC_API_KEY is not set (put it in .env.local), or pass --fake.");
    return 1;
  }

  const outDir = values["out-dir"] ? resolve(values["out-dir"]) : join(PROJECT_ROOT, "data", "regress", stamp());
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // ── Trials ──
  const played: Partial<Record<TrialName, Played>> = {};
  for (const t of trials) {
    if (reused[t]) {
      played[t] = { state: reused[t], wallMs: 0, file: join(reuseDir!, `${t}.json`) };
      continue;
    }
    io.err(`playing ${t} (${fake ? "fake" : "real"})...`);
    const script = scripts[t];
    const res = await runTrial({ caseFile, llm: newLlm(fake), script, budgets: scriptBudgets(script), injectMarkers: fake });
    const file = join(outDir, `${t}.json`);
    saveJson(file, res.state);
    played[t] = { state: res.state, wallMs: res.wallMs, file };
    for (const e of res.errors) io.err(`  ${t}: engine error: ${e}`);
    io.err(`  ${t}: verdict ${res.state.verdict?.outcome ?? "none"}, ${res.state.usage.length} calls, ${(res.wallMs / 1000).toFixed(1)}s`);
  }

  // ── Checks (each with its own Llm, so usage is attributed per check) ──
  const results: CheckResult[] = [];
  for (const name of selected) {
    io.err(`checking ${name}...`);
    if (name === "bluff") results.push(await checkBluff(played.bluff!.state, caseFile, newLlm(fake)));
    if (name === "invented") results.push(await checkInvented(played.invented!.state, caseFile, scripts.invented, newLlm(fake)));
    if (name === "real") results.push(checkReal(played.real!.state, caseFile));
    if (name === "consistency") results.push(await checkConsistency(played.real!.state, caseFile, newLlm(fake), runs));
  }

  // ── Report ──
  const trialUsage = (t: TrialName): UsageEntry[] => (reused[t] ? [] : (played[t]?.state.usage ?? []));
  const rows = results.map((r) => {
    const trial = r.name === "consistency" ? null : (r.name as TrialName);
    const usage = [...(trial ? trialUsage(trial) : []), ...r.usage];
    return { r, usage: summarizeUsage(usage, 0) };
  });
  // A real trial played only as input to consistency is still paid for.
  const extra = trials.filter((t) => !selected.includes(t)).flatMap(trialUsage);
  const all = [...trials.flatMap(trialUsage), ...results.flatMap((r) => r.usage)];
  const totals = summarizeUsage(all, Date.now() - t0);

  io.out("");
  io.out(`${"check".padEnd(12)} ${"result".padEnd(6)} ${"calls".padStart(6)} ${"cost $".padStart(9)}`);
  for (const { r, usage } of rows) io.out(`${r.name.padEnd(12)} ${(r.pass ? "PASS" : "FAIL").padEnd(6)} ${String(usage.calls).padStart(6)} ${usage.costUsd.toFixed(4).padStart(9)}`);
  if (extra.length) io.out(`${"(real input)".padEnd(12)} ${"".padEnd(6)} ${String(extra.length).padStart(6)} ${summarizeUsage(extra, 0).costUsd.toFixed(4).padStart(9)}`);
  io.out(`${"TOTAL".padEnd(12)} ${(results.every((r) => r.pass) ? "PASS" : "FAIL").padEnd(6)} ${String(totals.calls).padStart(6)} ${totals.costUsd.toFixed(4).padStart(9)}   (estimated ${est.total} calls; wall ${(totals.wallMs / 1000).toFixed(1)}s; cache-read share ${(totals.cacheReadShare * 100).toFixed(1)}%; refusals ${totals.refusals})`);
  for (const r of results) {
    io.out(`\n${r.name}: ${r.pass ? "PASS" : "FAIL"}`);
    for (const c of r.criteria) io.out(`  ${c.ok ? "ok  " : "FAIL"} ${c.text}`);
    for (const n of r.notes) io.out(`  note: ${n}`);
  }

  const report = {
    startedAt,
    endedAt: new Date().toISOString(),
    fake,
    runs,
    reusedFrom: reuseDir,
    selected,
    estimate: { total: est.total, assumptions: ESTIMATE_ASSUMPTIONS },
    trials: Object.fromEntries(
      trials.map((t) => [
        t,
        { file: played[t]!.file, reused: Boolean(reused[t]), verdict: played[t]!.state.verdict, wallMs: played[t]!.wallMs, usage: summarizeUsage(trialUsage(t), played[t]!.wallMs) },
      ]),
    ),
    results: rows.map(({ r, usage }) => ({ name: r.name, pass: r.pass, criteria: r.criteria, notes: r.notes, data: r.data, usage })),
    totals,
    pass: results.every((r) => r.pass),
  };
  saveJson(join(outDir, "report.json"), report);
  io.out(`\nsaved to ${outDir}`);
  return report.pass ? 0 : 1;
}

function parseOnly(only: string | undefined): CheckName[] {
  if (!only) return [...CHECKS];
  const names = only.split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (!(CHECKS as readonly string[]).includes(n)) throw new Error(`--only: unknown check "${n}" (choose from ${CHECKS.join(", ")})`);
  return CHECKS.filter((c) => names.includes(c));
}

function loadState(path: string, cf: CaseFile): TrialState {
  if (!existsSync(path)) throw new Error(`--reuse: no saved state at ${path}`);
  const s = JSON.parse(readFileSync(path, "utf8")) as TrialState;
  if (s.caseId !== cf.id || !Array.isArray(s.record) || !Array.isArray(s.juryCalls)) throw new Error(`--reuse: ${path} is not a ${cf.id} trial state`);
  if (s.phase !== "verdict") throw new Error(`--reuse: ${path} did not reach a verdict`);
  return s;
}

/** Calls the selected checks will make: trials (unless reused), leak checks, consistency replays. */
export function estimateRegression(
  trials: TrialName[],
  selected: CheckName[],
  scripts: Record<TrialName, Script>,
  cf: CaseFile,
  runs: number,
  reused: Partial<Record<TrialName, TrialState>> = {},
): { total: number; text: string } {
  const lines = ["Estimated API calls:"];
  let total = 0;
  for (const t of trials) {
    const e = estimateTrial(scripts[t], cf, scriptBudgets(scripts[t]));
    if (reused[t]) lines.push(`${t}: 0 (reused)`);
    else {
      total += e.total;
      lines.push(formatEstimate(`${t} trial`, e));
    }
    if ((t === "bluff" || t === "invented") && selected.includes(t)) {
      const n = reused[t] ? countCrossAnswers(reused[t]) : e.crossAnswers;
      total += n;
      lines.push(`${t} leak checks: ${n} (one per witness answer in the player's crosses${reused[t] ? "" : ", upper bound"})`);
    }
    if (t === "real" && selected.includes("consistency")) {
      const n = (reused.real ? reused.real.juryCalls.length : e.juryCalls) * runs;
      total += n;
      lines.push(`consistency: ${n} (${runs} runs x ${reused.real ? reused.real.juryCalls.length : e.juryCalls} jury calls)`);
    }
  }
  lines.push(`TOTAL: ~${total} API calls`, "Assumptions:", ...ESTIMATE_ASSUMPTIONS.map((a) => `  - ${a}`));
  return { total, text: lines.join("\n") };
}

const countCrossAnswers = (s: TrialState) =>
  s.record.filter((e) => e.kind === "answer" && (e.phase === "w1_cross" || e.phase === "w2_cross")).length;

runIfMain(import.meta.url, main);
