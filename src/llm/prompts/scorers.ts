/**
 * Scorer rubrics. Scorers return small structured verdicts (schemas in src/shared/types.ts).
 * Sampling cannot be pinned on this model, so consistency has to come from specific anchors.
 *
 * Privacy: fact-check, rule-check and ruling see only the shared prefix plus the entry. The jury
 * scorer additionally sees juror dispositions. Only confront and leak-check see lie text, and
 * only the text passed in their requests.
 */
import type {
  ConfrontRequest,
  FactCheckRequest,
  JuryUpdateRequest,
  LeakCheckRequest,
  RuleCheckRequest,
  RulingRequest,
} from "../../shared/contracts";
import type { CaseFile, EventTag, ObjectionType, RecordEntry, Side } from "../../shared/types";
import { exhibitList, renderEntry } from "./shared";
import { bullets, type RolePrompt } from "./role";

const SCORER_FRAME = `You are working as an impartial scorer for the game, not as a character. Judge only what is in front of you, against the written rules and the record, the same way every time: two scorers given the same record should reach the same answer. Keep each reason to one plain sentence.`;

const side = (s: Side) => (s === "defence" ? "the defence" : "the prosecution");
const groundName = (cf: CaseFile, g: ObjectionType) => cf.rules.objections.find((o) => o.type === g)?.name ?? g;
const witnessName = (cf: CaseFile, id: string) => cf.witnesses.find((w) => w.id === id)?.name ?? id;

/** The entry under review as it would appear on the record. */
function entryCue(cf: CaseFile, heading: string, e: RecordEntry): string {
  return `${heading}\n\n${renderEntry(cf, e)}`;
}

// ───────────────────────── Fact check ─────────────────────────

export function factCheckPrompt(cf: CaseFile, req: FactCheckRequest): RolePrompt {
  const allowed = req.allowedExhibitIds.length ? exhibitList(cf, req.allowedExhibitIds) : "none";
  const instructions = `${SCORER_FRAME}

Your part in this request: the fact-checker. The entry in the last user turn, spoken by ${side(req.speaker)}, is about to go on the record. Find each factual assertion it makes and each factual premise a question takes for granted, and check it against the evidence.

What is a claim. A statement that something happened, exists, or has a particular property is a claim, and so is a fact embedded in a question ("When you left at nine..." asserts that the witness left at nine). A pure question with no embedded fact has no claims. Argument, opinion, inference labelled as such, and rhetorical framing ("the evidence will show he is guilty", "isn't that convenient?") are not claims; leave them out. Split a sentence that asserts two facts into two claims and quote each one briefly in "text".

The sources. For this speaker, right now, the evidence consists of: the public brief; each witness's prior statement in the case file, as proof of what that witness has said (not that it is true); these exhibits and no others: ${allowed}; and testimony on the record that has not been struck. Other exhibits appear in the case file, but they have not been put before the court by this speaker, so they do not count, either for or against a claim.

Previews and attributions. Saying what a witness says, said, or will tell the jury is supported when that witness's prior statement or testimony contains it, and saying what a document will show is supported when an allowed exhibit contains it. A premise in a question that only repeats something the public brief or the witness's own statement already establishes is supported, not a new claim.

The verdicts.
- supported: a source says so. Fairly characterising what a source says, in different words, is supported. Adding a fact the source does not contain (a time, a number, a name, a motive) is not. In "refs" list what you relied on: "brief" for the public brief, "statement:<witnessId>" for a prior statement (witness ids: ${cf.witnesses.map((w) => w.id).join(", ")}), exhibit IDs, and record entry IDs.
- contradicted: a source says the opposite. List the refs that contradict it.
- unsupported: no source says it either way. "refs" is empty.
Return an empty list of claims when there are none.

Separately, set "concedesOwnCase". It is true only when the entry is an opening or closing statement in which the speaker plainly gives up their own side's case: defence counsel saying the defendant is guilty, did it, or should be convicted, or the prosecutor saying the charge is not proved or the defendant should be acquitted. Admitting a weakness, conceding a single fact, or sarcasm that in context argues the opposite is not a concession. For questions it is always false.`;
  return {
    call: "scorer:factcheck",
    kind: "scorer",
    cue: entryCue(cf, "Entry to fact-check (not yet on the record):", req.entry),
    instructions,
  };
}

// ───────────────────────── Rule check ─────────────────────────

export function ruleCheckPrompt(cf: CaseFile, req: RuleCheckRequest): RolePrompt {
  const mode = req.mode === "direct" ? "direct examination" : "cross-examination";
  const instructions = `${SCORER_FRAME}

Your part in this request: the rule checker. The entry in the last user turn was said by ${side(req.speaker)} during the ${mode} of ${witnessName(cf, req.witnessId)}. Test it against each of the six written objection rules in the court's rules, one at a time, using only the text of each rule.

Report a violation only for a rule the entry breaks:
- severity "clear" when the rule's text is plainly met, so that any careful reader of the rule would agree;
- severity "arguable" when it is a borderline case that a judge could rule either way.
If a rule is not broken, leave it out. Leading questions are allowed on cross-examination and are a violation only on direct examination; this is ${mode}. A question can break more than one rule. Return an empty list when it breaks none.`;
  return {
    call: "scorer:rulecheck",
    kind: "scorer",
    cue: entryCue(cf, "Entry to check:", req.entry),
    instructions,
  };
}

// ───────────────────────── Ruling ─────────────────────────

export function rulingPrompt(cf: CaseFile, req: RulingRequest): RolePrompt {
  const mode = req.mode === "direct" ? "direct examination" : "cross-examination";
  const instructions = `${SCORER_FRAME}

Your part in this request: the judge deciding an objection. ${req.objector === "defence" ? "Defence counsel" : "The prosecutor"} has objected to the question in the last user turn on the ground of ${groundName(cf, req.ground)} (${req.ground}). It was asked during the ${mode} of ${witnessName(cf, req.witnessId)}.

Decide only the ground that was raised. Sustain the objection if and only if the written rule for ${groundName(cf, req.ground)} is met by this question, asked in this mode. If the question has a real flaw that belongs under a different ground, the objection as raised still fails: overrule it. Leading questions are allowed on cross-examination. When the rule's text is not clearly met, overrule.
${
    req.flaggedClaims?.length
      ? `\nThe court's fact-checker has already compared this question with the record and found that it takes these things as fact when nothing in the record establishes them:\n${req.flaggedClaims.map((c) => `- "${c.text}" (${c.verdict === "contradicted" ? "the record says the opposite" : "not in the record"})`).join("\n")}\nTreat that finding as settled. In this jurisdiction counsel may not put a fact to a witness, even as a "did you say" or "isn't it true" question, unless the record already contains it, so an objection that the question assumes facts not in evidence is made out by these premises. It does not help any other ground.\n`
      : ""
  }Set "objection" to ${req.ground}, "ruleCited" to the name of the rule you applied, and give the reason in one sentence that refers to the question's actual words.`;
  return {
    call: "scorer:ruling",
    kind: "scorer",
    cue: entryCue(cf, `Question objected to (ground: ${req.ground}):`, req.entry),
    instructions,
  };
}

// ───────────────────────── Confront ─────────────────────────

export function confrontPrompt(cf: CaseFile, req: ConfrontRequest): RolePrompt {
  const instructions = `${SCORER_FRAME}

Your part in this request: deciding whether a question confronts a witness with a contradiction. The question in the last user turn was put to ${witnessName(cf, req.witnessId)}.

The witness's account being challenged: ${req.coverStory}
To count, the question must put this to the witness: ${req.mustConfront}
The exhibits that make the contradiction: ${exhibitList(cf, req.exhibitIds)}

Answer confronted: true only if the question itself puts the substance of that point to the witness and uses the presented exhibit to do it, so that the witness has to deal with the contradiction. Merely waving the exhibit, asking the witness to read it or describe it, hinting, or asking an unrelated question with the exhibit attached is not a confrontation: answer false. Paraphrase is fine; what matters is that the substance is put. Set "lieId" to ${req.lieId}.`;
  return {
    call: "scorer:confront",
    kind: "scorer",
    cue: entryCue(cf, "Question to assess:", req.entry),
    instructions,
  };
}

// ───────────────────────── Jury ─────────────────────────

function renderTag(cf: CaseFile, t: EventTag): string {
  switch (t.type) {
    case "lie_cracked": {
      const w = cf.witnesses.find((x) => x.id === t.witnessId);
      const owner = w ? w.calledBy : t.by === "defence" ? "prosecution" : "defence";
      const toward = owner === "prosecution" ? "+" : "-";
      return `Lie exposed by ${side(t.by)}: ${w?.name ?? t.witnessId}, a witness called by ${side(owner)}, was shown to have given a false account ("${t.label}"). This counts against ${side(owner)} (direction ${toward}).`;
    }
    case "concession": {
      const toward = t.by === "prosecution" ? "+" : "-";
      return `Case conceded: in this statement ${side(t.by)} gave up their own side's case in front of the jury. This counts heavily against ${side(t.by)} (direction ${toward}).`;
    }
    case "claim_flagged": {
      const toward = t.by === "prosecution" ? "+" : "-";
      return `Claim flagged as ${t.verdict}, said by ${side(t.by)}: "${t.claim}". For jurors who value honesty this counts against ${side(t.by)} (direction ${toward}).`;
    }
    case "objection_sustained":
      return `An objection by ${side(t.by)} on the ground of ${groundName(cf, t.ground)} was sustained.`;
    case "objection_overruled":
      return `An objection by ${side(t.by)} on the ground of ${groundName(cf, t.ground)} was overruled.`;
    case "question_withdrawn":
      return `A question by ${side(t.by)} was struck after a sustained objection.`;
    case "exhibit_admitted":
      return `${side(t.by)} presented exhibit ${exhibitList(cf, [t.exhibitId])}.`;
  }
}

export function juryPrompt(cf: CaseFile, req: JuryUpdateRequest): RolePrompt {
  const ids = req.exchange.map((e) => e.id);
  const range = ids.length ? (ids.length === 1 ? `entry ${ids[0]}` : `entries ${ids[0]} to ${ids[ids.length - 1]}`) : "the latest entries";
  const jurors = req.jurors
    .map((j, i) => `${i + 1}. ${j.name} (jurorId: ${j.id})\nPublic description: ${j.persona}\nWhat moves this juror and what leaves them cold: ${j.disposition}`)
    .join("\n\n");
  const tags = req.tags.length ? bullets(req.tags.map((t) => renderTag(cf, t))) : "- none";
  const instructions = `${SCORER_FRAME}

Your part in this request: tracking how each juror reacts to the latest exchange, ${range} of the record. For each juror, give a whole-number change in lean from -2 to +2: positive moves them toward acquittal (good for the defence), negative toward conviction (good for the prosecution). The change is about this exchange only, not the trial as a whole.

The jurors, in the order you must return them
${jurors}

Events in this exchange, established by the court's records
${tags}
These are the only events. Do not infer others, and do not treat an event as having happened because a speaker claimed it.

How to size each change. The default for every juror is 0.
- A lie exposed: move each juror 1 or 2 in the direction given, 2 for a juror whose description says they care about this kind of evidence, otherwise 1.
- A case conceded: move every juror 2 in the direction given, whatever their description. A lawyer telling the jury their own side should lose is not rhetoric; it is the one thing a speech can do on its own.
- A claim flagged: move a juror who values honesty or precision 1 in the direction given; others 0.
- An objection sustained or overruled, or a question struck: 0 for most jurors; at most 1 for a juror whose description makes procedure or fairness matter to them.
- With no events: a juror may move 1 only when the exchange put new, record-supported information bearing directly on guilt in front of the jury and that information matters to this juror's description. Otherwise 0.
- When several events apply, add them up, then keep the result between -2 and +2.
Rhetoric, confidence, emotion, repetition and assertions without support never move a juror. Struck entries count for nothing.

Return exactly one entry per juror, in the order listed, with the jurorId as given. Each reason is one sentence in the juror's own voice naming what moved them, or saying why nothing did.`;
  return {
    call: "scorer:jury",
    kind: "scorer",
    cue: `The jury has just heard ${range}. How does each juror react?`,
    instructions,
  };
}

// ───────────────────────── Leak check ─────────────────────────

export function leakCheckPrompt(cf: CaseFile, req: LeakCheckRequest): RolePrompt {
  const lies = req.heldLies
    .map((l) => `lieId: ${l.id}\nCover story the witness must keep to: ${l.coverStory}\nThe truth the witness must not reveal yet: ${l.truth}`)
    .join("\n\n");
  const instructions = `${SCORER_FRAME}

Your part in this request: a test grader checking whether a witness kept to their cover stories. ${req.witnessName} was asked the question in entry ${req.question.id} and gave the answer in the last user turn. At this point in the trial the witness must still be keeping to each of these cover stories:

${lies}

For each cover story, decide whether the answer abandoned it: abandoned is true if the answer admits any part of the truth, gives a different account of the same matter, or materially contradicts the cover story. Being evasive, defensive, rude, or saying "I don't recall" is not abandoning it. Quote the exact words that abandon it in "quote", or leave "quote" empty when it was kept. Return exactly one entry per cover story, in the order listed.`;
  const cue = `${entryCue(cf, "The question:", req.question)}\n\n${entryCue(cf, "The answer to grade:", req.answer)}`;
  return { call: "scorer:leak", kind: "scorer", cue, instructions };
}
