/**
 * Who speaks with which voice. The case file names voices (judge.voice, prosecution.voice,
 * clerk.voice, witnesses[].voice); anyone left out gets an unused fallback suited to their role,
 * matched by gender when their persona's pronouns say. The player and jurors are never voiced.
 */
import type { CaseFile, Speaker } from "../../shared/types";

type Gender = "male" | "female";

/** Fallback voices (all Deepgram Aura ids served by /v1/speak) with the gender they read as. */
const GENDER: Record<string, Gender> = {
  "aura-athena-en": "female", // Aura-1, British, mature
  "aura-helios-en": "male", // Aura-1, British
  "aura-angus-en": "male", // Aura-1, Irish
  "aura-2-draco-en": "male", // British
  "aura-2-pandora-en": "female", // British
  "aura-2-hyperion-en": "male", // Australian
  "aura-2-theia-en": "female", // Australian
  "aura-2-athena-en": "female",
  "aura-2-hera-en": "female",
  "aura-2-zeus-en": "male",
  "aura-2-orion-en": "male",
  "aura-2-arcas-en": "male",
  "aura-2-luna-en": "female",
  "aura-2-thalia-en": "female",
};

/** Role pools, best first. The clerk is code-written narration, so any clear voice will do. */
export const FALLBACK: Record<"judge" | "prosecutor" | "clerk" | "witness", string[]> = {
  judge: ["aura-athena-en", "aura-2-athena-en", "aura-helios-en", "aura-2-zeus-en"],
  prosecutor: ["aura-2-draco-en", "aura-helios-en", "aura-2-pandora-en", "aura-2-orion-en"],
  clerk: ["aura-helios-en", "aura-2-hyperion-en", "aura-2-athena-en"],
  witness: ["aura-angus-en", "aura-2-pandora-en", "aura-2-theia-en", "aura-2-hyperion-en", "aura-2-zeus-en", "aura-2-hera-en", "aura-2-arcas-en", "aura-2-luna-en", "aura-2-orion-en", "aura-2-thalia-en"],
};

/** "he/his/him" vs "she/her" in a persona. null when it does not say. */
export function guessGender(text: string): Gender | null {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const m = count(/\b(he|him|his|himself|mr)\b/gi);
  const f = count(/\b(she|her|hers|herself|ms|mrs)\b/gi);
  if (m === f) return null;
  return m > f ? "male" : "female";
}

/** Stable key for a voiced speaker; null for the player, who is never voiced. */
export function speakerVoiceKey(s: Speaker): string | null {
  if (s.kind === "player") return null;
  return s.kind === "witness" ? `w:${s.witnessId}` : s.kind;
}

/** Assigns every speaking role a distinct voice. Explicit voices win; fallbacks avoid them. */
export function castVoices(cf: CaseFile): Map<string, string> {
  const roles: { key: string; explicit?: string; pool: string[]; gender: Gender | null }[] = [
    { key: "judge", explicit: cf.judge.voice, pool: FALLBACK.judge, gender: guessGender(cf.judge.persona) },
    { key: "prosecutor", explicit: cf.prosecution.voice, pool: FALLBACK.prosecutor, gender: guessGender(cf.prosecution.persona) },
    { key: "clerk", explicit: cf.clerk?.voice, pool: FALLBACK.clerk, gender: null },
    ...cf.witnesses.map((w) => ({ key: `w:${w.id}`, explicit: w.voice, pool: FALLBACK.witness, gender: guessGender(w.persona) })),
  ];
  const cast = new Map<string, string>();
  const used = new Set<string>();
  for (const r of roles) {
    if (!r.explicit) continue;
    cast.set(r.key, r.explicit);
    used.add(r.explicit);
  }
  const everyone = Object.keys(GENDER);
  for (const r of roles) {
    if (cast.has(r.key)) continue;
    const fits = (v: string) => !used.has(v) && (r.gender === null || GENDER[v] === r.gender);
    const pick = r.pool.find(fits) ?? everyone.find(fits) ?? [...r.pool, ...everyone].find((v) => !used.has(v)) ?? r.pool[0]!;
    cast.set(r.key, pick);
    used.add(pick);
  }
  return cast;
}

export function voiceFor(cast: Map<string, string>, speaker: Speaker): string | null {
  const key = speakerVoiceKey(speaker);
  return key ? (cast.get(key) ?? null) : null;
}
