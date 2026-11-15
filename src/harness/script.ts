/**
 * Trial scripts: what a headless "player" says and does, validated with zod and checked
 * against the case file before anything runs.
 *
 * Fake mode. The real scripts are written in plain courtroom language. The fake model only
 * reacts to text markers ([confront], [unsupported], [violation:TYPE], [refuse]), so each item
 * may carry `fakeMarkers`; the runner appends them to the text ONLY when marker injection is on
 * (the default with --fake). The same script therefore drives both the paid and the free run.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_BUDGETS, ObjectionType, type Budgets, type CaseFile } from "../shared/types";
import { TUNING } from "../engine/tuning";

export const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
export const SCRIPTS_DIR = join(HARNESS_DIR, "scripts");
export const PROJECT_ROOT = resolve(HARNESS_DIR, "../..");
export const DEFAULT_SCRIPT = join(SCRIPTS_DIR, "full-win.json");

const Markers = z.array(z.string().regex(/^\[[a-z_]+(:[a-z_]+)?\]$/, "a fake marker looks like [confront] or [violation:leading]"));

export const ScriptQuestion = z.object({
  text: z.string().min(1),
  exhibitIds: z.array(z.string()).default([]),
  /** The question asserts something that is not in the case file; the invented check expects it flagged. */
  invented: z.boolean().default(false),
  /** Appended to the text only in fake mode. */
  fakeMarkers: Markers.default([]),
  /** Free-form author's note, ignored by the runner. */
  note: z.string().optional(),
});
export type ScriptQuestion = z.infer<typeof ScriptQuestion>;

export const Statement = z.object({
  text: z.string().min(1),
  invented: z.boolean().default(false),
  fakeMarkers: Markers.default([]),
});
export type Statement = z.infer<typeof Statement>;

const PolicyAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pass") }),
  z.object({ action: z.literal("object"), ground: ObjectionType }),
]);
export type PolicyAction = z.infer<typeof PolicyAction>;

export const ObjectionPolicy = z.object({
  default: PolicyAction.default({ action: "pass" }),
  /** index = 0-based position of the prosecutor's question to that witness (direct, or the defendant's cross). */
  overrides: z
    .array(
      z.discriminatedUnion("action", [
        z.object({ witnessId: z.string(), index: z.number().int().min(0), action: z.literal("pass") }),
        z.object({ witnessId: z.string(), index: z.number().int().min(0), action: z.literal("object"), ground: ObjectionType }),
      ]),
    )
    .default([]),
});
export type ObjectionPolicy = z.infer<typeof ObjectionPolicy>;

const Budget = z.number().int().min(0);

export const Script = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  caseId: z.string().default("calloway"),
  /** Script budgets; CLI flags override them. Missing keys use the engine defaults. */
  budgets: z.object({ direct: Budget.optional(), cross: Budget.optional(), client: Budget.optional() }).default({}),
  opening: Statement,
  closing: Statement,
  objections: ObjectionPolicy.default({ default: { action: "pass" }, overrides: [] }),
  /** witnessId -> questions for the player's cross of that prosecution witness. */
  crosses: z.record(z.string(), z.array(ScriptQuestion)),
  /** Re-asks of the same question after a refused witness turn, before moving on. */
  maxReasks: z.number().int().min(0).max(5).default(1),
});
export type Script = z.infer<typeof Script>;

export interface BudgetFlags {
  direct?: number;
  cross?: number;
  client?: number;
}

/** Engine budgets for a script: defaults, then the script's own, then CLI overrides. */
export function scriptBudgets(script: Script, overrides: BudgetFlags = {}): Budgets {
  const pick = (k: keyof BudgetFlags, fallback: number) => overrides[k] ?? script.budgets[k] ?? fallback;
  return {
    directQuestions: pick("direct", DEFAULT_BUDGETS.directQuestions),
    crossQuestions: pick("cross", DEFAULT_BUDGETS.crossQuestions),
    clientCrossQuestions: pick("client", DEFAULT_BUDGETS.clientCrossQuestions),
  };
}

/** The text actually sent: markers are appended only in fake mode. */
export function itemText(item: { text: string; fakeMarkers: string[] }, injectMarkers: boolean): string {
  const text = item.text.trim();
  return injectMarkers && item.fakeMarkers.length ? `${text} ${item.fakeMarkers.join(" ")}` : text;
}

const MARKER_RE = /\[(confront|unsupported|contradicted|refuse|violation:\w+)\]/;

/** Problems with a script against a case file. Empty means usable. */
export function validateScript(script: Script, caseFile: CaseFile): string[] {
  const problems: string[] = [];
  const exhibits = new Set(caseFile.evidence.map((e) => e.id));
  const witnesses = new Map(caseFile.witnesses.map((w) => [w.id, w]));
  if (script.caseId !== caseFile.id) problems.push(`script is for case "${script.caseId}", not "${caseFile.id}"`);

  const checkText = (where: string, text: string, max: number) => {
    if (text.length > max) problems.push(`${where}: text longer than ${max} characters`);
    if (MARKER_RE.test(text)) problems.push(`${where}: fake marker in the text itself (put it in fakeMarkers)`);
  };
  checkText("opening", script.opening.text, TUNING.limits.maxStatementChars);
  checkText("closing", script.closing.text, TUNING.limits.maxStatementChars);

  for (const [wid, qs] of Object.entries(script.crosses)) {
    const w = witnesses.get(wid);
    if (!w) problems.push(`crosses.${wid}: no such witness`);
    else if (w.calledBy !== "prosecution") problems.push(`crosses.${wid}: the player only cross-examines prosecution witnesses`);
    qs.forEach((q, i) => {
      checkText(`crosses.${wid}[${i}]`, q.text, TUNING.limits.maxQuestionChars);
      for (const id of q.exhibitIds) if (!exhibits.has(id)) problems.push(`crosses.${wid}[${i}]: unknown exhibit ${id}`);
    });
  }
  for (const [i, o] of script.objections.overrides.entries()) {
    if (!witnesses.has(o.witnessId)) problems.push(`objections.overrides[${i}]: no such witness ${o.witnessId}`);
  }
  return problems;
}

/** A bare name ("bluff") resolves into the scripts directory; otherwise a path from the cwd. */
export function resolveScriptPath(nameOrPath: string): string {
  if (existsSync(nameOrPath)) return resolve(nameOrPath);
  const inDir = join(SCRIPTS_DIR, nameOrPath.endsWith(".json") ? nameOrPath : `${nameOrPath}.json`);
  if (!isAbsolute(nameOrPath) && existsSync(inDir)) return inDir;
  throw new Error(`script not found: ${nameOrPath}`);
}

export function parseScript(raw: unknown, source = "(inline)"): Script {
  const r = Script.safeParse(raw);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`script ${source} is invalid:\n${lines.join("\n")}`);
  }
  return r.data;
}

/** Loads, parses and (with a case file) cross-checks a script. Throws listing every problem. */
export function loadScript(nameOrPath: string, caseFile?: CaseFile): Script {
  const path = resolveScriptPath(nameOrPath);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`script ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const script = parseScript(raw, path);
  if (caseFile) {
    const problems = validateScript(script, caseFile);
    if (problems.length) throw new Error(`script ${path} does not fit case ${caseFile.id}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  return script;
}

/** The policy action for the prosecutor's index-th question to a witness. */
export function policyFor(script: Script, witnessId: string, index: number): PolicyAction {
  const o = script.objections.overrides.find((x) => x.witnessId === witnessId && x.index === index);
  if (!o) return script.objections.default;
  return o.action === "pass" ? { action: "pass" } : { action: "object", ground: o.ground };
}
