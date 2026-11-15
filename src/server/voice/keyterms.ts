/**
 * Keyterm prompting for Nova-3 speech-to-text: the case's proper nouns, so "Halvorsen",
 * "Calloway" and "E7" come back spelled the way the case file spells them. Built from the
 * case file, never hard-coded. Deepgram caps keyterms at 500 tokens per request and
 * recommends 20-50 terms (https://developers.deepgram.com/docs/keyterm).
 */
import type { CaseFile } from "../../shared/types";

export const MAX_KEYTERMS = 50;
/** A conservative stand-in for the 500-token cap (a token is roughly four characters). */
const MAX_KEYTERM_CHARS = 1200;

/** Capitalised words that are ordinary English, titles, or dates rather than names. */
const COMMON = new Set(
  (
    "a an and the of in on at to for by from with as or but if not no yes this that these those it its he she his her they them their " +
    "i we you our your my me mr mrs ms dr sgt judge counsel exhibit exhibits police officer statement email from subject date signed " +
    "director guard conservator museum square garage street floor wing room door office corridor stairwell stair gallery galleries " +
    "upper ground east west north south front staff night day evening morning afternoon agreed facts plan " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october " +
    "november december am pm item change cover premium effective requested patient reason plan collected optometrist readers " +
    "monitored alerts code slots permit holder vehicle charge times copy since found conservation height"
  ).split(" "),
);

/**
 * Capitalised words in running prose (the word before is lowercase, or an opening quote), with
 * counts. This skips sentence starts and the column headings and dates of logs and tables.
 */
function properNouns(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = /(?:\b[a-z][a-z']*,?[ \t]+|["“(])([A-Z][a-zà-ÿ]+(?:[-'][A-Z][a-z]+)?)/g;
  for (const m of text.matchAll(re)) {
    const w = m[1]!;
    if (w.length < 3 || COMMON.has(w.toLowerCase())) continue;
    out.set(w, (out.get(w) ?? 0) + 1);
  }
  return out;
}

/** Codes such as "SD-3" or "HM-2231". */
const codes = (text: string) => [...text.matchAll(/\b[A-Z]{2,4}-\d{1,4}\b/g)].map((m) => m[0]);

const stripTitle = (name: string) => name.replace(/^(judge|justice|mr|mrs|ms|dr)\.?\s+/i, "").trim();

export function buildKeyterms(cf: CaseFile, max = MAX_KEYTERMS): string[] {
  const people = [cf.defendantName, ...cf.witnesses.map((w) => w.name), stripTitle(cf.judge.name), cf.prosecution.name].map(stripTitle);
  const ordered: string[] = [];
  // Full names, then surnames (counsel says "Ms Arden", "Mr Renn").
  ordered.push(...people);
  ordered.push(...people.map((p) => p.split(/\s+/).at(-1)!));
  ordered.push(...cf.evidence.map((e) => e.id));

  const publicText = [cf.title, cf.charge, cf.publicBrief, ...cf.evidence.map((e) => e.title)].join("\n");
  const docText = cf.evidence.map((e) => e.text).join("\n");
  ordered.push(...codes(publicText), ...codes(docText));
  const ranked = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  ordered.push(...ranked(properNouns(publicText)), ...ranked(properNouns(docText)));

  const seen = new Set<string>();
  const out: string[] = [];
  let chars = 0;
  for (const t of ordered) {
    const term = t.trim();
    const k = term.toLowerCase();
    if (!term || seen.has(k)) continue;
    if (out.length >= max || chars + term.length > MAX_KEYTERM_CHARS) break;
    seen.add(k);
    out.push(term);
    chars += term.length;
  }
  return out;
}
