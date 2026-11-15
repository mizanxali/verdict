/** Pure text helpers for dictation (no browser globals, so they can be unit-tested). */

/** Inserts dictated text at the cursor (replacing any selection), with sensible spacing. */
export function insertAt(value: string, text: string, selStart: number, selEnd: number): { value: string; caret: number } {
  const s = Math.max(0, Math.min(selStart, value.length));
  const e = Math.max(s, Math.min(selEnd, value.length));
  const before = value.slice(0, s);
  const after = value.slice(e);
  const lead = before && !/\s$/.test(before) && !/^[,.;:!?]/.test(text) ? " " : "";
  const trail = after && !/^[\s,.;:!?]/.test(after) ? " " : "";
  return { value: before + lead + text + trail + after, caret: (before + lead + text).length };
}
