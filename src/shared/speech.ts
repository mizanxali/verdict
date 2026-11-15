/**
 * Turning dialogue text into speech requests. Shared by the browser (which decides what to
 * request, sentence by sentence, while a line is still streaming) and the server (which cleans
 * the text it is asked to voice and checks it belongs to the record).
 *
 * Everything here is pure and deterministic. In particular `splitSpeech` is prefix-stable:
 * a segment it returns for a partial text is returned unchanged for any longer version of that
 * text, so the browser can request audio for a sentence the moment it completes.
 */

export interface SpeechSegment {
  /** Offsets into the raw text, [start, end). Segments are contiguous from 0. */
  start: number;
  end: number;
  /** The raw slice, trimmed. This is what the browser sends; the server cleans it. */
  text: string;
}

/** Below this, a sentence waits to be joined by the next one (fewer, more natural requests). */
export const MIN_SEGMENT_CHARS = 40;
/** A run-on sentence is cut at a clause break once it passes this many characters. */
export const SOFT_MAX_SEGMENT_CHARS = 220;
/** The server refuses longer requests. Deepgram's own limit is far higher. */
export const MAX_SPEECH_CHARS = 600;

const TERMINATORS = ".!?…";
const CLOSERS = `"'”’)]»`;
/** Words that end in a full stop without ending the sentence. Compared lowercased. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "sgt", "insp", "supt", "det", "prof", "rev", "no", "nos", "vs", "v",
  "etc", "e.g", "i.e", "approx", "jr", "sr", "mt", "fig", "cf", "al", "ref", "hon", "lt", "col", "capt",
]);

/**
 * Where does the sentence that ends at a terminator run `[i, j)` really end, if it does?
 * Returns the boundary offset (after any closing quotes or brackets), or -1 if this is not a
 * boundary or not yet decidable (nothing follows it yet and the text is not final).
 */
function boundaryAt(text: string, i: number, final: boolean): number {
  let j = i;
  while (j < text.length && TERMINATORS.includes(text[j]!)) j++;
  while (j < text.length && CLOSERS.includes(text[j]!)) j++;
  if (j >= text.length) return final ? j : -1;
  if (!/\s/.test(text[j]!)) return -1; // "2.4", "e.g", "E1."+"x"
  if (text[i] === ".") {
    // The word before the full stop: an abbreviation or an initial is not a sentence end.
    const m = /([A-Za-z][A-Za-z.]*)$/.exec(text.slice(Math.max(0, i - 12), i));
    const word = m?.[1] ?? "";
    if (ABBREVIATIONS.has(word.toLowerCase())) return -1;
    if (/^[A-Z]$/.test(word)) return -1; // "P. Holm", "C. Arden"
  }
  return j;
}

/** Offsets just after each complete sentence. Paragraph breaks count as sentence ends. */
function sentenceEnds(text: string, final: boolean): number[] {
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (TERMINATORS.includes(ch)) {
      // Treat a run of terminators ("?!", "...") as one, decided at its first character.
      const b = boundaryAt(text, i, final);
      let k = i;
      while (k + 1 < text.length && TERMINATORS.includes(text[k + 1]!)) k++;
      if (b > 0) ends.push(b);
      i = Math.max(i, b > 0 ? b - 1 : k);
    } else if (ch === "\n" && text[i + 1] === "\n" && text.slice(ends.at(-1) ?? 0, i).trim()) {
      ends.push(i);
    }
  }
  if (final && text.slice(ends.at(-1) ?? 0).trim()) ends.push(text.length);
  return ends;
}

/** First clause break (", " "; " ": " " — ") at or after `from`, before `limit`. Offset after it. */
function clauseBreak(text: string, from: number, limit: number): number {
  const re = /[,;:](?=\s)|\s[—–-]{1,2}(?=\s)/g;
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m || m.index >= limit) return -1;
  const after = m.index + m[0].length;
  // Only decidable once something follows the break.
  return after < text.length && text.slice(after).trim() ? after : -1;
}

/**
 * Splits text into speakable segments: whole sentences, short ones joined up to
 * MIN_SEGMENT_CHARS, run-ons cut at a clause break past SOFT_MAX_SEGMENT_CHARS.
 * With `final` false, the unfinished tail is left out. The very first segment is never held
 * back for joining, so speech can start as soon as the first sentence is complete.
 */
export function splitSpeech(text: string, final: boolean): SpeechSegment[] {
  const ends = sentenceEnds(text, final);
  const out: SpeechSegment[] = [];
  let start = 0;
  let e = 0; // index into ends
  const push = (end: number) => {
    const slice = text.slice(start, end).trim();
    if (slice) out.push({ start, end, text: slice });
    else if (out.length) out[out.length - 1]!.end = end; // whitespace joins the previous segment
    start = end;
  };
  while (start < text.length) {
    // Skip sentence ends we have already passed.
    while (e < ends.length && ends[e]! <= start) e++;
    const minLen = out.length === 0 ? 1 : MIN_SEGMENT_CHARS;
    // Accumulate sentences until long enough.
    let k = e;
    let cut = -1;
    while (k < ends.length) {
      const end = ends[k]!;
      if (text.slice(start, end).trim().length >= minLen || (final && k === ends.length - 1)) {
        cut = end;
        break;
      }
      k++;
    }
    // A run-on sentence: cut at a clause break once it is long, if that comes first.
    const soft = clauseBreak(text, start + SOFT_MAX_SEGMENT_CHARS, cut >= 0 ? cut : text.length + 1);
    if (soft > 0 && (cut < 0 || soft < (ends[e] ?? Infinity))) cut = soft;
    if (cut < 0) break;
    push(cut);
  }
  if (final && start < text.length) push(text.length);
  if (final && out.length) out[out.length - 1]!.end = text.length;
  return out;
}

// ───────────────────────── Cleaning text for the voice ─────────────────────────

const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** "6" -> "six" up to twenty; anything larger is left as digits, which the voice reads fine. */
const numberWord = (digits: string) => SMALL[Number(digits)] ?? digits;

/**
 * Makes a line fit to be spoken: drops stage directions and citations the listener cannot use
 * ("*sighs*", "(pauses)", "(E4)", "[aside]"), strips markdown, and spells out identifiers a voice
 * would stumble over ("E6" -> "E six", "SD-3" -> "S D 3"). Returns "" when nothing speakable is left.
 */
export function cleanForSpeech(raw: string): string {
  let s = raw;
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1"); // **bold** is emphasis, keep the words
  s = s.replace(/\*[^*\n]*\*/g, " "); // *stage direction*
  s = s.replace(/\[[^\]\n]*\]/g, " "); // [aside], [violation:...] markers
  s = s.replace(/\([^)\n]*\)/g, " "); // (pauses), (E4), (Exhibit E1)
  s = s.replace(/[()[\]*_`#>|~]/g, " "); // unmatched brackets and markdown leftovers
  s = s.replace(/^\s*[-•]\s+/gm, ""); // list bullets
  s = s.replace(/&/g, " and ");
  s = s.replace(/\bE(\d{1,2})\b/g, (_, d: string) => `E ${numberWord(d)}`);
  s = s.replace(/\b([A-Z]{2,4})-(\d+)\b/g, (_, l: string, d: string) => `${l.split("").join(" ")} ${d}`);
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\s+([,.;:!?…])/g, "$1"); // "word ." left by a removal
  s = s.replace(/([,;:])(?:\s*[,;:])+/g, "$1");
  s = s.replace(/^[\s,;:.]+/, "");
  s = s.trim();
  return /[A-Za-z0-9]/.test(s) ? s : "";
}
