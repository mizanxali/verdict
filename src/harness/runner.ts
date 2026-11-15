/**
 * The one trial-running loop shared by driver.ts and regress.ts: plays a script against the
 * engine from `begin` to `verdict`, answering whatever the engine is waiting for.
 *
 * Edge cases handled here:
 * - act() rejects an action that does not fit `pending` (InvalidActionError). A rejected
 *   question is skipped and reported; any other rejection is a harness bug and is rethrown.
 * - A refused witness turn strikes the question and leaves pending === "question" without
 *   spending budget. The same question is re-asked at most `script.maxReasks` times, then the
 *   runner moves on, so a stubborn model cannot loop the script.
 * - A hard cap on the total number of actions guards against any other loop.
 * - Jury updates run in the background: the runner always awaits engine.idle() before returning.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createTrial } from "../engine/index";
import { createLlm } from "../llm/index";
import { InvalidActionError, type Llm } from "../shared/contracts";
import { createFakeLlm } from "../shared/fakeLlm";
import type { Budgets, CaseFile, PlayerAction, TrialEvent, TrialState } from "../shared/types";
import { itemText, policyFor, type Script } from "./script";

export interface RunOptions {
  caseFile: CaseFile;
  llm: Llm;
  script: Script;
  budgets: Budgets;
  /** Append each item's fakeMarkers to its text (fake mode). */
  injectMarkers: boolean;
  id?: string;
  /** Every engine event, as emitted. */
  onEvent?: (e: TrialEvent) => void;
  /** Safety cap on player actions. */
  maxActions?: number;
}

export interface RunResult {
  state: TrialState;
  wallMs: number;
  actions: number;
  /** Questions re-asked after a refused witness turn. */
  reasks: number;
  /** Questions dropped after refusals used up their re-asks. */
  abandoned: { witnessId: string; index: number; text: string }[];
  /** Script questions never asked because the cross budget ran out first. */
  unasked: { witnessId: string; index: number; text: string }[];
  /** Actions the engine rejected (InvalidActionError messages). */
  rejected: string[];
  /** Engine "error" and "notice" events. */
  errors: string[];
  notices: string[];
}

/** One Llm per trial: the engine sets llm.onUsage. The real one reads ANTHROPIC_API_KEY. */
export function newLlm(fake: boolean): Llm {
  return fake ? createFakeLlm() : createLlm({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined });
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function runTrial(opts: RunOptions): Promise<RunResult> {
  const { caseFile, llm, script, budgets, injectMarkers } = opts;
  const errors: string[] = [];
  const notices: string[] = [];
  const engine = createTrial({
    caseFile,
    llm,
    budgets,
    id: opts.id,
    emit: (e) => {
      if (e.type === "error") errors.push(e.message);
      if (e.type === "notice") notices.push(e.text);
      opts.onEvent?.(e);
    },
  });

  const started = Date.now();
  const maxActions = opts.maxActions ?? 500;
  const cursor: Record<string, number> = {};
  const tries: Record<string, number> = {};
  const abandoned: RunResult["abandoned"] = [];
  const rejected: string[] = [];
  let actions = 0;
  let reasks = 0;

  const act = async (a: PlayerAction) => {
    if (++actions > maxActions) throw new Error(`runner stopped after ${maxActions} actions (phase ${engine.state.phase})`);
    await engine.act(a);
  };

  for (;;) {
    const s = engine.state;
    if (s.phase === "verdict" && s.pending === null) break;
    switch (s.pending) {
      case "begin":
        await act({ type: "begin" });
        break;
      case "opening":
        await act({ type: "opening", text: itemText(script.opening, injectMarkers) });
        break;
      case "closing":
        await act({ type: "closing", text: itemText(script.closing, injectMarkers) });
        break;
      case "objection_window": {
        const wid = s.witnessId!;
        const index = s.record.filter((e) => e.phase === s.phase && e.kind === "question" && e.speaker.kind === "prosecutor").length - 1;
        const p = policyFor(script, wid, index);
        await act(p.action === "pass" ? { type: "pass" } : { type: "object", ground: p.ground });
        break;
      }
      case "question": {
        const wid = s.witnessId!;
        const list = script.crosses[wid] ?? [];
        const i = cursor[wid] ?? 0;
        const q = list[i];
        if (!q) {
          await act({ type: "end_cross" });
          break;
        }
        const before = { phase: s.phase, left: s.questionsLeft };
        const text = itemText(q, injectMarkers);
        try {
          await act({ type: "ask", text, exhibitIds: [...q.exhibitIds] });
        } catch (err) {
          if (!(err instanceof InvalidActionError)) throw err;
          rejected.push(`${wid}[${i}]: ${err.message}`);
          cursor[wid] = i + 1;
          break;
        }
        const after = engine.state;
        const refused = after.phase === before.phase && after.pending === "question" && after.questionsLeft === before.left;
        if (!refused) {
          cursor[wid] = i + 1;
          break;
        }
        const key = `${wid}:${i}`;
        tries[key] = (tries[key] ?? 0) + 1;
        if (tries[key]! > script.maxReasks) {
          abandoned.push({ witnessId: wid, index: i, text: q.text });
          cursor[wid] = i + 1;
        } else {
          reasks++;
        }
        break;
      }
      case null:
        throw new Error(`engine stopped with nothing pending in phase ${s.phase}`);
    }
  }
  await engine.idle();

  const unasked: RunResult["unasked"] = [];
  for (const [wid, list] of Object.entries(script.crosses)) {
    list.forEach((q, i) => {
      if (i >= (cursor[wid] ?? 0)) unasked.push({ witnessId: wid, index: i, text: q.text });
    });
  }

  return { state: engine.state, wallMs: Date.now() - started, actions, reasks, abandoned, unasked, rejected, errors, notices };
}

export function saveJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Filesystem-safe timestamp, e.g. 2026-11-15T10-04-33-120Z. */
export function stamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-");
}
