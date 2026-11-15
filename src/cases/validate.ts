/**
 * Cross-reference checks for a case file that the zod schema cannot express.
 * Returns a list of human-readable problems; an empty list means the case is sound.
 */
import { ObjectionType, type CaseFile } from "../shared/types";

/** Minimum plan lengths: one step per question the prosecutor is budgeted to ask. */
export const MIN_DIRECT_STEPS = 4;
export const MIN_DEFENDANT_CROSS_STEPS = 6;
export const JUROR_COUNT = 5;

export function validateCase(c: CaseFile): string[] {
  const problems: string[] = [];
  const exhibitIds = new Set(c.evidence.map((e) => e.id));
  const witnessIds = new Set(c.witnesses.map((w) => w.id));

  // ── Unique IDs (one namespace: exhibits, witnesses, lies, jurors) ──
  const seen = new Map<string, string>();
  const claim = (id: string, where: string) => {
    const prior = seen.get(id);
    if (prior) problems.push(`Duplicate id "${id}": used by ${prior} and ${where}.`);
    else seen.set(id, where);
  };
  for (const e of c.evidence) claim(e.id, `exhibit "${e.title}"`);
  for (const w of c.witnesses) {
    claim(w.id, `witness ${w.name}`);
    for (const l of w.lies) claim(l.id, `a lie of ${w.name}`);
  }
  for (const j of c.jurors) claim(j.id, `juror ${j.name}`);

  // ── Lies and breakers ──
  for (const w of c.witnesses) {
    for (const l of w.lies) {
      l.breakers.forEach((b, i) => {
        for (const id of b.exhibitIds) {
          if (!exhibitIds.has(id)) {
            problems.push(`Lie "${l.id}" (${w.name}), breaker ${i + 1}: exhibit "${id}" does not exist.`);
          }
        }
        if (!b.mustConfront.trim()) {
          problems.push(`Lie "${l.id}" (${w.name}), breaker ${i + 1}: mustConfront is empty.`);
        }
      });
    }
  }

  // ── Witness order and sides ──
  const [w1, w2, w3] = c.witnesses;
  for (const [i, w] of [w1, w2].entries()) {
    if (w && w.calledBy !== "prosecution") {
      problems.push(`witnesses[${i}] (${w.name}) must be calledBy: prosecution, not ${w.calledBy}.`);
    }
  }
  if (w3) {
    if (w3.calledBy !== "defence") {
      problems.push(`witnesses[2] (${w3.name}) is the defendant and must be calledBy: defence, not ${w3.calledBy}.`);
    }
    if (w3.name !== c.defendantName) {
      problems.push(`witnesses[2] is "${w3.name}" but defendantName is "${c.defendantName}"; the defendant must be the third witness.`);
    }
  }

  // ── Prosecution plan ──
  const plan = c.prosecution.plan;
  for (const key of Object.keys(plan)) {
    if (!witnessIds.has(key)) problems.push(`prosecution.plan has a key "${key}" that is not a witness id.`);
  }
  c.witnesses.forEach((w, i) => {
    const steps = plan[w.id];
    if (!steps) {
      problems.push(`prosecution.plan has no entry for witness "${w.id}".`);
      return;
    }
    const min = i === 2 ? MIN_DEFENDANT_CROSS_STEPS : MIN_DIRECT_STEPS;
    if (steps.length < min) {
      problems.push(`prosecution.plan.${w.id} has ${steps.length} steps; it needs at least ${min}.`);
    }
    steps.forEach((s, j) => {
      for (const id of s.exhibitIds) {
        if (!exhibitIds.has(id)) problems.push(`prosecution.plan.${w.id}[${j}]: exhibit "${id}" does not exist.`);
      }
    });
  });

  // The prosecutor must be able to crack each of the defendant's lies from the plan:
  // some breaker's exhibits must all be presented somewhere in the cross plan.
  if (w3) {
    const planned = new Set((plan[w3.id] ?? []).flatMap((s) => s.exhibitIds));
    for (const l of w3.lies) {
      const breakable = l.breakers.some((b) => b.exhibitIds.every((id) => planned.has(id)));
      if (!breakable) {
        problems.push(`Defendant's lie "${l.id}" cannot be cracked from prosecution.plan.${w3.id}: no step presents all of any one breaker's exhibits.`);
      }
    }
  }

  // ── Objection rules: each of the six exactly once ──
  const ruleCounts = new Map<string, number>();
  for (const o of c.rules.objections) ruleCounts.set(o.type, (ruleCounts.get(o.type) ?? 0) + 1);
  for (const t of ObjectionType.options) {
    const n = ruleCounts.get(t) ?? 0;
    if (n === 0) problems.push(`rules.objections has no rule for "${t}".`);
    if (n > 1) problems.push(`rules.objections has ${n} rules for "${t}"; expected one.`);
  }
  if (c.rules.evidence.length === 0) problems.push("rules.evidence is empty.");

  // ── Timeline ──
  c.timeline.forEach((t, i) => {
    for (const id of t.knownBy) {
      if (!witnessIds.has(id)) problems.push(`timeline[${i}] (${t.time}): knownBy "${id}" is not a witness id.`);
    }
  });

  // ── Jurors ──
  if (c.jurors.length !== JUROR_COUNT) {
    problems.push(`There are ${c.jurors.length} jurors; there must be ${JUROR_COUNT}.`);
  }
  for (const j of c.jurors) {
    // Lean is clamped to -10..+10. acquitAt must sit strictly above -10 or the juror can
    // never vote guilty, and strictly above startLean or the juror starts out acquitting.
    if (j.acquitAt <= -10) {
      problems.push(`Juror "${j.id}": acquitAt ${j.acquitAt} means they can never vote guilty.`);
    }
    if (j.acquitAt > 10) {
      problems.push(`Juror "${j.id}": acquitAt ${j.acquitAt} is above the maximum lean of 10, so they can never acquit.`);
    }
    if (j.startLean >= j.acquitAt) {
      problems.push(`Juror "${j.id}": startLean ${j.startLean} is already at or above acquitAt ${j.acquitAt}, so they start out voting not guilty.`);
    }
  }

  // ── Voices (optional): every speaker who has one must sound different ──
  const voices = new Map<string, string>();
  const voiced: [string | undefined, string][] = [
    [c.judge.voice, `the judge (${c.judge.name})`],
    [c.prosecution.voice, `the prosecutor (${c.prosecution.name})`],
    [c.clerk?.voice, "the clerk"],
    ...c.witnesses.map((w): [string | undefined, string] => [w.voice, `witness ${w.name}`]),
  ];
  for (const [voice, who] of voiced) {
    if (!voice) continue;
    const prior = voices.get(voice);
    if (prior) problems.push(`Voice "${voice}" is given to both ${prior} and ${who}; each speaker needs their own.`);
    else voices.set(voice, who);
  }

  return problems;
}
