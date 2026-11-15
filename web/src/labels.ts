import type { EventTag, ObjectionType, Phase, PlayerView, Speaker } from "../../src/shared/types";

export type CaseInfo = PlayerView["caseInfo"];

export const TRIAL_PHASES: Phase[] = [
  "opening",
  "w1_direct",
  "w1_cross",
  "w2_direct",
  "w2_cross",
  "w3_cross",
  "closing",
  "verdict",
];

/** Witness order is fixed by the case file: two prosecution witnesses, then the defendant. */
export function phaseWitness(phase: Phase, info: CaseInfo) {
  const idx = phase.startsWith("w1") ? 0 : phase.startsWith("w2") ? 1 : phase.startsWith("w3") ? 2 : -1;
  return idx >= 0 ? info.witnesses[idx] : undefined;
}

export function phaseLabel(phase: Phase, info: CaseInfo): string {
  const w = phaseWitness(phase, info);
  switch (phase) {
    case "case_review":
      return "Case review";
    case "opening":
      return "Opening statements";
    case "w1_direct":
    case "w2_direct":
      return `Direct examination of ${w?.name ?? "the witness"}`;
    case "w1_cross":
    case "w2_cross":
      return `Your cross-examination of ${w?.name ?? "the witness"}`;
    case "w3_cross":
      return `Prosecution cross-examines ${w?.name ?? "the defendant"}`;
    case "closing":
      return "Closing arguments";
    case "verdict":
      return "Verdict";
  }
}

export function phaseShort(phase: Phase, info: CaseInfo): string {
  const w = phaseWitness(phase, info);
  const surname = w?.name.split(" ").slice(-1)[0] ?? "";
  switch (phase) {
    case "case_review":
      return "Review";
    case "opening":
      return "Openings";
    case "w1_direct":
    case "w2_direct":
      return `${surname}: direct`;
    case "w1_cross":
    case "w2_cross":
    case "w3_cross":
      return `${surname}: cross`;
    case "closing":
      return "Closings";
    case "verdict":
      return "Verdict";
  }
}

export type SpeakerClass = "judge" | "prosecutor" | "witness" | "player" | "clerk";

export function speakerClass(s: Speaker): SpeakerClass {
  return s.kind;
}

export function speakerName(s: Speaker, info: CaseInfo): string {
  switch (s.kind) {
    case "player":
      return "Defence (you)";
    case "prosecutor":
      return `Prosecution · ${info.prosecutorName}`;
    case "judge":
      return `The Court · ${info.judgeName}`;
    case "clerk":
      return "Clerk";
    case "witness": {
      const w = info.witnesses.find((x) => x.id === s.witnessId);
      return w ? `${w.name}${w.id === info.witnesses[2]?.id ? " (defendant)" : ""}` : "Witness";
    }
  }
}

export function witnessName(id: string | null | undefined, info: CaseInfo): string {
  return info.witnesses.find((w) => w.id === id)?.name ?? "Unknown witness";
}

export function objectionName(t: ObjectionType, info: CaseInfo): string {
  return info.rules.objections.find((o) => o.type === t)?.name ?? t.replace("_", " ");
}

const sideName = (s: "defence" | "prosecution") => (s === "defence" ? "defence" : "prosecution");

export function tagLabel(t: EventTag, info: CaseInfo): string {
  switch (t.type) {
    case "lie_cracked":
      return `${witnessName(t.witnessId, info)} caught out: ${t.label}`;
    case "concession":
      return `${sideName(t.by) === "defence" ? "You" : "The prosecution"} conceded the case`;
    case "claim_flagged":
      return `${t.verdict === "contradicted" ? "Contradicted" : "Unsupported"} claim by the ${sideName(t.by)}`;
    case "objection_sustained":
      return `${sideName(t.by) === "defence" ? "Your" : "Prosecution"} ${objectionName(t.ground, info).toLowerCase()} objection sustained`;
    case "objection_overruled":
      return `${sideName(t.by) === "defence" ? "Your" : "Prosecution"} ${objectionName(t.ground, info).toLowerCase()} objection overruled`;
    case "question_withdrawn":
      return `${sideName(t.by) === "defence" ? "Your" : "Prosecution"} question struck`;
    case "exhibit_admitted":
      return `${t.exhibitId} admitted by the ${sideName(t.by)}`;
  }
}

/** Does this tag help (+1), hurt (-1) or neither (0) the defence? Used only for colouring chips. */
export function tagPolarity(t: EventTag): -1 | 0 | 1 {
  const mine = "by" in t && t.by === "defence" ? 1 : -1;
  switch (t.type) {
    case "lie_cracked":
    case "objection_sustained":
      return mine;
    case "concession":
    case "claim_flagged":
    case "objection_overruled":
    case "question_withdrawn":
      return mine === 1 ? -1 : 1;
    case "exhibit_admitted":
      return 0;
  }
}

export const formatLean = (n: number) => (n > 0 ? `+${n}` : `${n}`);
export const formatCost = (n: number) => (n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** Validated categorical slots (light surface, parchment): blue, orange, aqua, amber, magenta. */
export const JUROR_COLORS = ["#2a78d6", "#d95926", "#199e70", "#c98500", "#d55181"];

export const entryNumber = (id: string) => Number(id.replace(/\D/g, "")) || 0;

/** Short display names for jurors: first names, unless two jurors share one. */
export function shortNames(people: { id: string; name: string }[]): Map<string, string> {
  const first = people.map((p) => p.name.split(" ")[0] ?? p.name);
  const dup = new Set(first.filter((f, i) => first.indexOf(f) !== i));
  return new Map(people.map((p, i) => [p.id, dup.has(first[i]!) ? p.name : first[i]!]));
}
