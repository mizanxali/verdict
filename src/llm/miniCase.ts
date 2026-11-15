/**
 * A miniature, self-contained case for the llm tests and smoke script. Every private field holds
 * a distinctive marker phrase (PRIVATE-...) so tests can prove none of it reaches the shared prefix.
 */
import type { LlmContext, WitnessBrief } from "../shared/contracts";
import type { CaseFile, RecordEntry } from "../shared/types";

const OBJECTIONS: CaseFile["rules"]["objections"] = [
  { type: "relevance", name: "Relevance", rule: "A question must bear on whether the defendant committed the charged act.", example: "Asking about the witness's favourite film." },
  { type: "hearsay", name: "Hearsay", rule: "A witness may not repeat what someone else said out of court to prove that it is true.", example: "What did your neighbour tell you she saw?" },
  { type: "leading", name: "Leading", rule: "On direct examination a question may not suggest its own answer.", example: "You saw him at the door at nine, didn't you?" },
  { type: "speculation", name: "Speculation", rule: "A witness may not be asked to guess at facts outside their own knowledge, including another person's thoughts.", example: "Why do you think he did it?" },
  { type: "assumes_facts", name: "Assumes facts not in evidence", rule: "A question may not take for granted a fact that is not in the public brief, an admitted exhibit or the testimony.", example: "After you hid the key, where did you go?" },
  { type: "badgering", name: "Badgering", rule: "Counsel may not harass, insult or argue with a witness instead of asking a question.", example: "You are a liar, aren't you?" },
];

export const miniCase: CaseFile = {
  id: "mini",
  title: "The Crown v. Ada Pell",
  charge: "Theft of the Harbour Society's tide clock",
  playerSide: "defence",
  defendantName: "Ada Pell",
  publicBrief:
    "On the night of 3 March the brass tide clock was taken from the Harbour Society reading room in Saltmere. The room was locked at 8 p.m. by the caretaker. Ada Pell, a society member, holds one of three keys. The clock was found the next day in a skip behind the fish market.",
  rules: {
    objections: OBJECTIONS,
    evidence: [
      "An exhibit counts as evidence only after it has been presented in court.",
      "Testimony struck after a sustained objection is not evidence.",
    ],
  },
  timeline: [{ time: "21:40", event: "PRIVATE-TIMELINE the caretaker re-entered the room", knownBy: ["moss"] }],
  evidence: [
    { id: "E1", title: "Door log", kind: "log", text: "Reading room door, 3 March: 20:02 locked (key 2). 21:41 unlocked (key 1). 21:49 locked (key 1)." },
    { id: "E2", title: "Key register", kind: "register", text: "Key 1: caretaker J. Moss. Key 2: secretary R. Lund. Key 3: member A. Pell." },
  ],
  witnesses: [
    {
      id: "moss",
      name: "Jory Moss",
      role: "Caretaker of the Harbour Society",
      calledBy: "prosecution",
      publicStatement: "I locked up at eight and went straight home. I did not go back that night.",
      persona: "PRIVATE-PERSONA gruff, clipped sentences",
      knows: ["PRIVATE-KNOWS the skip is emptied on Fridays"],
      lies: [
        {
          id: "moss-return",
          label: "Moss went back to the room",
          topic: "whether Moss returned to the reading room that night",
          coverStory: "PRIVATE-COVER I went straight home at eight and stayed in all night.",
          truth: "PRIVATE-TRUTH Moss let himself back in at 21:41 with key 1.",
          concession: "PRIVATE-CONCESSION All right, I went back for my pipe, around twenty to ten.",
          breakers: [{ exhibitIds: ["E1"], mustConfront: "PRIVATE-MUSTCONFRONT the log shows key 1 at 21:41" }],
        },
      ],
    },
    {
      id: "lund",
      name: "Rhea Lund",
      role: "Secretary of the Harbour Society",
      calledBy: "prosecution",
      publicStatement: "Ada Pell argued with the committee about the clock last month.",
      persona: "PRIVATE-PERSONA precise and prim",
      knows: ["PRIVATE-KNOWS the argument was about insurance"],
      lies: [],
    },
    {
      id: "pell",
      name: "Ada Pell",
      role: "The defendant, a society member",
      calledBy: "defence",
      publicStatement: "I was at the choir rehearsal until ten.",
      persona: "PRIVATE-PERSONA nervous but sincere",
      knows: ["PRIVATE-KNOWS the choirmaster took a register"],
      lies: [],
    },
  ],
  prosecution: {
    name: "PRIVATE-PROSNAME Mr. Gale",
    persona: "PRIVATE-PROSPERSONA courteous, relentless",
    theory: "PRIVATE-THEORY Pell used key 3 after the argument",
    openingPoints: ["PRIVATE-OPENPOINT Pell had a key and a grudge"],
    closingPoints: ["PRIVATE-CLOSEPOINT nobody else had reason to take it"],
    plan: { moss: [{ topic: "PRIVATE-PLAN locking up at eight", exhibitIds: [] }] },
  },
  judge: { name: "Judge Okafor", persona: "Dry, patient, allergic to theatrics." },
  jurors: [
    { id: "j1", name: "Tam", persona: "A retired harbour pilot.", disposition: "PRIVATE-DISP1 trusts logs and instruments", startLean: 0, acquitAt: 1 },
    { id: "j2", name: "Bea", persona: "A school librarian.", disposition: "PRIVATE-DISP2 punishes anyone caught lying", startLean: 0, acquitAt: 1 },
    { id: "j3", name: "Olu", persona: "A night-shift baker.", disposition: "PRIVATE-DISP3 suspicious of the police", startLean: 0, acquitAt: 1 },
    { id: "j4", name: "Mags", persona: "A shop owner.", disposition: "PRIVATE-DISP4 values plain speaking", startLean: 0, acquitAt: 1 },
    { id: "j5", name: "Ivo", persona: "A student.", disposition: "PRIVATE-DISP5 follows procedure closely", startLean: 0, acquitAt: 1 },
  ],
};

export function miniRecord(): RecordEntry[] {
  return [
    { id: "r1", phase: "opening", speaker: { kind: "prosecutor" }, kind: "statement", text: "The evidence will show Ada Pell had a key and a motive.", exhibitIds: [], stricken: false, tags: [] },
    { id: "r2", phase: "opening", speaker: { kind: "player" }, kind: "statement", text: "Three people held keys. Listen to the door log.", exhibitIds: [], stricken: false, tags: [] },
    { id: "r3", phase: "w1_direct", speaker: { kind: "prosecutor" }, kind: "question", text: "What time did you lock the reading room?", exhibitIds: [], stricken: false, tags: [] },
    { id: "r4", phase: "w1_direct", speaker: { kind: "witness", witnessId: "moss" }, kind: "answer", text: "Eight o'clock, same as always.", exhibitIds: [], stricken: false, tags: [] },
  ];
}

export function miniCtx(record: RecordEntry[] = miniRecord()): LlmContext {
  return { caseFile: miniCase, record };
}

/** What the engine would hand the witness actor for Moss while the lie is held. */
export function mossBrief(status: "held" | "justCracked" = "held"): WitnessBrief {
  const w = miniCase.witnesses[0]!;
  const lie = w.lies[0]!;
  return {
    witnessId: w.id,
    name: w.name,
    role: w.role,
    persona: w.persona,
    publicStatement: w.publicStatement,
    knows: w.knows,
    lies: [
      status === "held"
        ? { id: lie.id, topic: lie.topic, status: "held", coverStory: lie.coverStory, justCracked: false }
        : { id: lie.id, topic: lie.topic, status: "cracked", coverStory: lie.coverStory, truth: lie.truth, concession: lie.concession, justCracked: true },
    ],
  };
}

/** Every private string in the mini case, for leak assertions. */
export function privateStrings(cf: CaseFile = miniCase): string[] {
  const out: string[] = [];
  for (const t of cf.timeline) out.push(t.event);
  for (const w of cf.witnesses) {
    out.push(w.persona, ...w.knows);
    for (const l of w.lies) out.push(l.label, l.topic, l.coverStory, l.truth, l.concession, ...l.breakers.map((b) => b.mustConfront));
  }
  for (const j of cf.jurors) out.push(j.disposition);
  const p = cf.prosecution;
  out.push(p.name, p.persona, p.theory, ...p.openingPoints, ...p.closingPoints);
  for (const steps of Object.values(p.plan)) for (const s of steps) out.push(s.topic);
  out.push(cf.judge.persona);
  return out;
}
