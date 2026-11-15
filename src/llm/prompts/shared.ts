/**
 * The shared prefix: identical bytes for every role, built ONLY from public fields.
 *
 * Reads from the case file: title, charge, defendantName, publicBrief, rules, evidence,
 * witnesses[].{id,name,role,calledBy,publicStatement}, jurors[].{id,name,persona}, judge.name.
 * Never reads: timeline, witnesses[].{persona,knows,lies}, jurors[].{disposition,startLean,acquitAt},
 * prosecution.*, judge.persona. Everything is rendered in case-file order with no clocks or IDs
 * that vary between calls, so the bytes are stable.
 */
import type { CaseFile, Phase, RecordEntry, Side, Speaker } from "../../shared/types";

const GAME_FRAME = `This is a text-only courtroom drama game. Everything in it is fiction: the jurisdiction, its laws, the people and the events are invented for the game, and no real person or case is involved. A human player acts as defence counsel. The other parts are played by an AI, one part per request: the witnesses, the prosecutor and the judge (the actors), and a set of impartial scorers that check what is said against the record, rule on objections, and track how each of the five jurors is leaning.

Program code keeps the official state of the trial: what is on the record, which exhibits have been shown to whom, how objections were ruled, which witnesses have been caught out. Nothing an actor says changes that state by itself, and scorers only report on what is in front of them. Each request ends with a section that names the part being played in that request and gives its instructions. Follow that section; everything before it is shared background that every part sees.

How the trial runs. After the case review come opening statements, the prosecution first and then the defence. The prosecution calls two witnesses; each is examined on direct by the prosecutor and then cross-examined by defence counsel. The defendant then takes the stand and is cross-examined by the prosecutor, with defence counsel able to object. Closing statements follow, the prosecution first and the defence last, and then the jury decides. On direct examination a party questions its own witness; on cross-examination a party questions the other side's witness.

What counts as evidence. Only three things are evidence: the undisputed facts in the public brief, exhibits that have been presented in court, and testimony on the record that has not been struck. Opening and closing statements, questions, and objections are not evidence. An entry struck after a sustained objection stays visible in the record but must be disregarded.`;

function renderRules(caseFile: CaseFile): string {
  const objections = caseFile.rules.objections
    .map((o) => `${o.name} (ground: ${o.type})\nRule: ${o.rule}\nExample: ${o.example}`)
    .join("\n\n");
  const evidence = caseFile.rules.evidence.map((r) => `- ${r}`).join("\n");
  return `THE COURT'S WRITTEN RULES

Objections. Counsel may object to a question on one of the six grounds below. Each written rule is the whole of the rule: a question breaks it only when the rule's own text is met, and a flaw that fits a different ground is not a breach of this one. Leading questions are permitted on cross-examination.

${objections}

Evidence rules.
${evidence}`;
}

const sideName = (s: Side) => (s === "defence" ? "the defence" : "the prosecution");

function renderCaseFile(caseFile: CaseFile): string {
  const exhibits = caseFile.evidence
    .map((e) => `Exhibit ${e.id}: ${e.title} (${e.kind})\n${e.text}`)
    .join("\n\n");
  const n = caseFile.witnesses.length;
  const witnesses = caseFile.witnesses
    .map(
      (w, i) =>
        `Witness ${i + 1} of ${n}: ${w.name} (id: ${w.id}), ${w.role}. Called by ${sideName(w.calledBy)}.\nPrior statement: ${w.publicStatement}`,
    )
    .join("\n\n");
  const jurors = caseFile.jurors.map((j) => `- ${j.name} (id: ${j.id}): ${j.persona}`).join("\n");
  return `THE PUBLIC CASE FILE

Case: ${caseFile.title}
Charge: ${caseFile.charge}
Defendant: ${caseFile.defendantName}
Presiding judge: ${caseFile.judge.name}

Public brief (undisputed facts and setting)
${caseFile.publicBrief}

Exhibits (the full text of every document in the case file; an exhibit is evidence only once it has been presented in court)

${exhibits}

Witnesses, in the order they are called

${witnesses}

The jury
${jurors}`;
}

/** Top-level system prompt text. Cache breakpoint goes at its end. */
export function renderSystem(caseFile: CaseFile): string {
  return `${GAME_FRAME}\n\n${renderRules(caseFile)}\n\n${renderCaseFile(caseFile)}`;
}

// ───────────────────────── Record ─────────────────────────

export const RECORD_HEADER = `THE TRIAL RECORD

What follows is the official record of the trial so far, one entry per block, in order. Each entry has an ID (r1, r2, ...) that other parts of the game use to refer to it.`;

export const RECORD_EMPTY = `(The record is empty: nothing has been said in court yet.)`;

export function phaseLabel(caseFile: CaseFile, phase: Phase): string {
  const w = (i: number) => caseFile.witnesses[i]?.name ?? `witness ${i + 1}`;
  switch (phase) {
    case "case_review":
      return "Case review";
    case "opening":
      return "Opening statements";
    case "w1_direct":
      return `Direct examination of ${w(0)} by the prosecution`;
    case "w1_cross":
      return `Cross-examination of ${w(0)} by the defence`;
    case "w2_direct":
      return `Direct examination of ${w(1)} by the prosecution`;
    case "w2_cross":
      return `Cross-examination of ${w(1)} by the defence`;
    case "w3_cross":
      return `Cross-examination of ${w(2)} by the prosecution`;
    case "closing":
      return "Closing statements";
    case "verdict":
      return "Verdict";
  }
}

export function speakerLabel(caseFile: CaseFile, s: Speaker): string {
  switch (s.kind) {
    case "player":
      return "Defence counsel";
    case "prosecutor":
      return "Prosecutor";
    case "judge":
      return `The judge (${caseFile.judge.name})`;
    case "clerk":
      return "Clerk (court narration)";
    case "witness": {
      const w = caseFile.witnesses.find((x) => x.id === s.witnessId);
      return w ? `Witness ${w.name}` : `Witness ${s.witnessId}`;
    }
  }
}

export function exhibitList(caseFile: CaseFile, ids: readonly string[]): string {
  return ids
    .map((id) => {
      const e = caseFile.evidence.find((x) => x.id === id);
      return e ? `${id} (${e.title})` : id;
    })
    .join(", ");
}

/**
 * One record entry as one block of text. Deliberately excludes `stricken`, `tags` and
 * `factCheck`, which code may set after the entry is first written: including them would
 * rewrite an earlier block and miss the cache from that point on. Struck entries are listed
 * in a separate note after the cached blocks instead (renderStrickenNote).
 */
export function renderEntry(caseFile: CaseFile, e: RecordEntry): string {
  const exhibits = e.exhibitIds.length ? `\nExhibits presented with it: ${exhibitList(caseFile, e.exhibitIds)}` : "";
  return `Entry ${e.id}. ${phaseLabel(caseFile, e.phase)}.\nSpeaker: ${speakerLabel(caseFile, e.speaker)}. Type: ${e.kind}.${exhibits}\n\n${e.text}`;
}

export function renderStrickenNote(record: readonly RecordEntry[]): string | null {
  const ids = record.filter((e) => e.stricken).map((e) => e.id);
  if (!ids.length) return null;
  return `Struck from the record: ${ids.join(", ")}. These entries remain visible above but are not evidence; disregard them.`;
}
