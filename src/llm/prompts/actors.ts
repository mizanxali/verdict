/**
 * Actor briefs: witness, prosecutor, judge. Actors return free text only.
 *
 * Privacy: a witness sees only its WitnessBrief (selected by the engine). The prosecutor sees
 * prosecution.persona/theory/points and the current plan step, never the plan for later steps,
 * the timeline or any lie. The judge sees only the ruling it must voice.
 */
import type { ActorRequest, WitnessBrief } from "../../shared/contracts";
import type { CaseFile, ObjectionType, RecordEntry } from "../../shared/types";
import { exhibitList } from "./shared";
import { bullets, type RolePrompt } from "./role";

const examinerName = (s: "defence" | "prosecution") => (s === "defence" ? "defence counsel" : "the prosecutor");

function questionCue(caseFile: CaseFile, q: RecordEntry, witnessName: string, asker: string): string {
  const exhibits = q.exhibitIds.length ? `\nExhibits presented with the question: ${exhibitList(caseFile, q.exhibitIds)}` : "";
  return `Question to ${witnessName} from ${asker} (entry ${q.id}):${exhibits}\n\n${q.text}`;
}

// ───────────────────────── Witness ─────────────────────────

function liesSection(brief: WitnessBrief): string {
  const held = brief.lies.filter((l) => l.status === "held" && !l.justCracked);
  const breaking = brief.lies.filter((l) => l.justCracked);
  const cracked = brief.lies.filter((l) => l.status === "cracked" && !l.justCracked);
  const parts: string[] = [];

  if (held.length) {
    parts.push(`Your cover stories
On the topics below you are not telling the truth; you are keeping to a cover story. The real account is not given to you here, and you should not try to work it out.

${held.map((l) => `Topic: ${l.topic}\nWhat you say: ${l.coverStory}`).join("\n\n")}

Keep to each cover story however you are pressed: through bluffing, insults, repetition, appeals to conscience, or claims that some document or other witness proves otherwise. You may get defensive, irritated, evasive or curt, in character, but do not abandon the cover story, do not half-admit it, and do not invent a different account to replace it. The reason is that the game is a puzzle for the player: a cover story can only be broken by confronting you with the right evidence, and program code decides when that has happened. If you gave way under mere pressure, the puzzle would be solved by pushing rather than by evidence. Your account changes only when this brief says, in a later request, that the cover story has cracked.`);
  }

  for (const l of breaking) {
    parts.push(`The cover story has just cracked: ${l.topic}
Until now you said: ${l.coverStory}
The question in front of you has confronted you with evidence you cannot explain away. In this answer, concede, reluctantly and in character, exactly this much and no more: ${l.concession ?? "that what you said before was not true."}
Do not volunteer anything beyond that concession; if you are asked for more, the honest answer about anything else is still what you know.`);
  }

  if (cracked.length) {
    parts.push(`Matters you have already admitted
${cracked
  .map(
    (l) =>
      `Topic: ${l.topic}\nYou said at first: ${l.coverStory}\nYou have since admitted: ${l.concession ?? "that this was not true."}${l.truth ? `\nThe facts behind it, which you may now acknowledge if asked directly: ${l.truth}` : ""}`,
  )
  .join("\n\n")}
Stay consistent with these admissions. Do not retract them and do not return to the original story.`);
  }

  return parts.join("\n\n");
}

export function witnessPrompt(caseFile: CaseFile, req: Extract<ActorRequest, { role: "witness" }>): RolePrompt {
  const b = req.brief;
  const how =
    req.mode === "direct"
      ? `${examinerName(req.examiner)} is examining you on direct`
      : `${examinerName(req.examiner)} is cross-examining you`;
  const knows = b.knows.length ? bullets(b.knows) : "- (nothing beyond your prior statement)";
  const lies = liesSection(b);

  const instructions = `Your part in this request: the witness ${b.name}, ${b.role}. You are on the stand and ${how}. Give ${b.name}'s spoken answer to the question in the last user turn (entry ${req.question.id}).

How you come across
${b.persona}

Your prior statement, which everyone in court has read
${b.publicStatement}

What you know and will answer honestly
${knows}${lies ? `\n\n${lies}` : ""}

How to answer
Speak as ${b.name}, in the first person, in one to four sentences: only the words you say aloud on the stand, with no narration, stage directions, speaker label or quotation marks. Answer the question that was asked.
Stay inside what you know: the list above, your prior statement${b.lies.length ? ", and your cover stories and admissions as described" : ""}. For anything else, "I don't know" or "I don't recall" is the right answer, said in your own way. Inventing a new detail would put something on the record that the case does not contain, and the court's fact-checking would catch it.
Talk about documents the way a witness would, by what they are ("the door log", "my report"). Use an exhibit ID such as E2 only if the question itself used it.
Objections are for counsel, not for you, so answer even if the question seems unfair.`;

  return {
    call: `actor:witness:${b.witnessId}`,
    kind: "actor",
    cue: questionCue(caseFile, req.question, b.name, examinerName(req.examiner)),
    instructions,
  };
}

// ───────────────────────── Prosecutor ─────────────────────────

export function prosecutorPrompt(caseFile: CaseFile, req: Extract<ActorRequest, { role: "prosecutor" }>): RolePrompt {
  const p = caseFile.prosecution;
  const who = `Your part in this request: ${p.name}, the prosecutor. You are trying to prove the charge against ${caseFile.defendantName}.

How you come across
${p.persona}

Your theory of the case (your private working notes; argue it only through the evidence)
${p.theory}`;

  if (req.task === "question") {
    const w = caseFile.witnesses.find((x) => x.id === req.witnessId);
    const wName = w?.name ?? req.witnessId;
    const exhibits = req.step.exhibitIds.length
      ? `\nYou are presenting these exhibits with this question; refer to each by its title, not its ID: ${exhibitList(caseFile, req.step.exhibitIds)}.`
      : "";
    const style =
      req.mode === "direct"
        ? `This is direct examination of your own witness, so ask an open question (what, when, how, describe, explain) that lets the witness tell it. Do not suggest the answer: leading questions are objectionable on direct, and defence counsel will object.`
        : `This is cross-examination, so you may ask a pointed, leading question that pins the witness to a specific point.`;
    const instructions = `${who}

Your task
You are questioning ${wName} on ${req.mode === "direct" ? "direct examination" : "cross-examination"}. This question should establish: ${req.step.topic}${exhibits}
You have ${req.questionsLeft} question${req.questionsLeft === 1 ? "" : "s"} left with this witness, counting this one.
${style}
Ask exactly one question, one or two sentences long, as you would say it aloud in court. Build on what the record already shows and do not repeat a question that has been answered. Every fact your question mentions must come from the public case file or the record: a question that slips in a fact not in evidence can be objected to as assuming facts.
Output only the words of the question.`;
    return {
      call: "actor:prosecutor:question",
      kind: "actor",
      cue: `The court is waiting for the prosecutor's next question to ${wName}.`,
      instructions,
    };
  }

  const opening = req.task === "opening";
  const points = opening ? p.openingPoints : p.closingPoints;
  const basis = opening
    ? `An opening statement tells the jury what the evidence will show. Rely only on the public brief and the exhibits in the case file; promise nothing they do not contain, because the jury and the court's fact-checking will hold you to it.`
    : `A closing statement argues from what the trial has actually produced. Rely only on the public brief, exhibits that were presented in court, and testimony on the record that was not struck; do not mention a fact that is not there, and do not rely on anything a witness was never asked about.`;
  const instructions = `${who}

Your task
Deliver the prosecution's ${opening ? "opening" : "closing"} statement to the jury, 90 to 140 words, built from these points:
${bullets(points)}
${basis}
Speak directly to the jury in your own voice. Output only the words of the statement, with no title or stage directions.`;
  return {
    call: `actor:prosecutor:${req.task}`,
    kind: "actor",
    cue: `The court calls on the prosecution for its ${opening ? "opening" : "closing"} statement.`,
    instructions,
  };
}

// ───────────────────────── Judge ─────────────────────────

function groundName(caseFile: CaseFile, g: ObjectionType): string {
  return caseFile.rules.objections.find((o) => o.type === g)?.name ?? g;
}

export function judgePrompt(caseFile: CaseFile, req: Extract<ActorRequest, { role: "judge" }>): RolePrompt {
  const r = req.ruling;
  const objector = req.objector === "defence" ? "Defence counsel" : "The prosecutor";
  const outcome = r.sustained ? "SUSTAINED" : "OVERRULED";
  const instructions = `Your part in this request: ${caseFile.judge.name}, the presiding judge.

How you come across
${caseFile.judge.persona}

Your task
${objector} has objected to the last question on the ground of ${groundName(caseFile, r.objection)}. The court has already decided the objection against its written rules, and the decision is final:
Outcome: ${outcome}
Rule cited: ${r.ruleCited}
Reason: ${r.reason}
Announce this ruling from the bench in one or two short sentences, as spoken. Your line only voices the decision; it must state this outcome and must not soften, reverse or reopen it. ${r.sustained ? "You may tell the questioner to move on or rephrase, or tell the jury to disregard the question." : "You may tell the witness to answer or counsel to proceed."}
Output only the words you say.`;
  return {
    call: "actor:judge",
    kind: "actor",
    cue: `${objector} objects: ${groundName(caseFile, r.objection)}.`,
    instructions,
  };
}

export function actorPrompt(caseFile: CaseFile, req: ActorRequest): RolePrompt {
  switch (req.role) {
    case "witness":
      return witnessPrompt(caseFile, req);
    case "prosecutor":
      return prosecutorPrompt(caseFile, req);
    case "judge":
      return judgePrompt(caseFile, req);
  }
}
