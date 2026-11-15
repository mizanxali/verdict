/**
 * A small, valid case for engine tests. Private fields carry SECRET markers so redaction tests
 * can grep for them.
 */
import { CaseFile } from "../shared/types";

export const fixtureCase = (): CaseFile =>
  CaseFile.parse({
    id: "fixture",
    title: "R v Vance",
    charge: "Theft of the harbour payroll",
    playerSide: "defence",
    defendantName: "Sam Vance",
    publicBrief: "The harbour payroll went missing on the night of 3 March.",
    rules: {
      objections: [
        { type: "relevance", name: "Relevance", rule: "Must relate to the charge.", example: "What is your star sign?" },
        { type: "hearsay", name: "Hearsay", rule: "No repeating others' out-of-court words.", example: "Bob told me..." },
        { type: "leading", name: "Leading", rule: "No leading on direct.", example: "You saw him, didn't you?" },
        { type: "speculation", name: "Speculation", rule: "Witnesses state what they know.", example: "What was he thinking?" },
        { type: "assumes_facts", name: "Assumes facts not in evidence", rule: "No invented facts.", example: "After you fled..." },
        { type: "badgering", name: "Badgering", rule: "No harassment.", example: "Answer me!" },
      ],
      evidence: ["Only admitted exhibits are evidence."],
    },
    timeline: [{ time: "21:00", event: "TIMELINE_SECRET Renn takes the payroll", knownBy: ["renn"] }],
    evidence: [
      { id: "E1", title: "Payroll log", kind: "log", text: "Payroll locked at 20:00." },
      { id: "E2", title: "Dock CCTV", kind: "photo description", text: "Renn at the docks at 21:05." },
      { id: "E3", title: "Receipt", kind: "receipt", text: "Vance bought fuel near the harbour at 21:10." },
      { id: "E4", title: "Lab report", kind: "report", text: "No prints on the safe." },
    ],
    witnesses: [
      {
        id: "renn",
        name: "Ada Renn",
        role: "payroll clerk",
        calledBy: "prosecution",
        publicStatement: "I locked up and went home.",
        persona: "PERSONA_SECRET_renn nervous, over-explains",
        knows: ["The safe was locked at 20:00."],
        lies: [
          {
            id: "L1",
            label: "LABEL_L1 Renn was at the docks",
            topic: "where Renn was at 21:00",
            coverStory: "I was at home all evening.",
            truth: "TRUTH_L1 Renn was at the docks with the payroll.",
            concession: "CONCESSION_L1 I was at the docks that night.",
            breakers: [{ exhibitIds: ["E2"], mustConfront: "The CCTV shows her at the docks at 21:05." }],
          },
        ],
      },
      {
        id: "okafor",
        name: "Dr Okafor",
        role: "forensic examiner",
        calledBy: "prosecution",
        publicStatement: "The safe was opened with a key.",
        persona: "PERSONA_SECRET_okafor precise",
        knows: ["Only two keys exist."],
        lies: [
          {
            id: "L2",
            label: "LABEL_L2 Okafor skipped the print test",
            topic: "the fingerprint test",
            coverStory: "I tested the safe for prints.",
            truth: "TRUTH_L2 Okafor never ran the print test.",
            concession: "CONCESSION_L2 I did not run it.",
            breakers: [{ exhibitIds: ["E1", "E4"], mustConfront: "The lab report and log show no test ran." }],
          },
        ],
      },
      {
        id: "vance",
        name: "Sam Vance",
        role: "the defendant",
        calledBy: "defence",
        publicStatement: "I was nowhere near the harbour.",
        persona: "PERSONA_SECRET_vance defensive",
        knows: ["He drove past the harbour."],
        lies: [
          {
            id: "L3",
            label: "LABEL_L3 Vance was near the harbour",
            topic: "where Vance was at 21:10",
            coverStory: "I was at the cinema.",
            truth: "TRUTH_L3 Vance was buying fuel by the harbour.",
            concession: "CONCESSION_L3 I stopped for fuel by the harbour.",
            breakers: [{ exhibitIds: ["E3"], mustConfront: "The receipt puts him by the harbour at 21:10." }],
          },
        ],
      },
    ],
    prosecution: {
      name: "Ms Hale",
      persona: "PERSONA_SECRET_hale clipped",
      theory: "PROSECUTION_SECRET Vance took the payroll.",
      openingPoints: ["The payroll vanished.", "Vance had a key."],
      closingPoints: ["Vance lied about where he was."],
      plan: {
        renn: [{ topic: "locking the safe", exhibitIds: ["E1"] }, { topic: "who had keys" }],
        okafor: [{ topic: "how the safe was opened" }],
        vance: [{ topic: "his evening" }, { topic: "[confront] the fuel receipt", exhibitIds: ["E3"] }],
      },
    },
    judge: { name: "Judge Moss", persona: "PERSONA_SECRET_moss dry" },
    jurors: [1, 2, 3, 4, 5].map((n) => ({
      id: `j${n}`,
      name: `Juror ${n}`,
      persona: `Public blurb ${n}`,
      disposition: `DISPOSITION_SECRET_${n}`,
      startLean: 0,
      acquitAt: 1,
    })),
  });

/** Strings that must never reach the player before the matching lie is exposed. */
export const SECRET_MARKERS = [
  "TIMELINE_SECRET",
  "PERSONA_SECRET",
  "DISPOSITION_SECRET",
  "PROSECUTION_SECRET",
  "TRUTH_",
  "CONCESSION_",
  "LABEL_",
];
