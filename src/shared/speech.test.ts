import { describe, expect, it } from "vitest";
import { cleanForSpeech, MIN_SEGMENT_CHARS, splitSpeech } from "./speech";

const texts = (t: string, final: boolean) => splitSpeech(t, final).map((s) => s.text);

describe("splitSpeech", () => {
  it("sends the first sentence alone, then joins short sentences", () => {
    const t = "Yes, sir. I was at the desk. All evening. Then I heard a bang from the east side, upstairs.";
    expect(texts(t, true)).toEqual(["Yes, sir.", "I was at the desk. All evening. Then I heard a bang from the east side, upstairs."]);
  });

  it("holds back an unfinished sentence until the text is final", () => {
    expect(texts("I was at the desk. Then I heard", false)).toEqual(["I was at the desk."]);
    expect(texts("I was at the desk. Then I heard", true)).toEqual(["I was at the desk.", "Then I heard"]);
  });

  it("does not decide a sentence until something follows its full stop", () => {
    expect(texts("I was at the desk.", false)).toEqual([]);
    expect(texts("I was at the desk.", true)).toEqual(["I was at the desk."]);
  });

  it("is prefix-stable: segments of a partial text survive as the text grows", () => {
    const full =
      "Members of the jury. On the night of 14 March, Mr. Renn says he saw her face; he did not. " +
      "Sgt. P. Holm took her statement at 8:30 am (Exhibit E1). The value rose from 2.4 to 6.5 million crowns! " +
      "Why? Because the director asked for it... and nobody checked. \"It was her,\" he said. Then nothing.";
    const finalSegs = splitSpeech(full, true);
    for (let n = 1; n <= full.length; n++) {
      const partial = splitSpeech(full.slice(0, n), false);
      partial.forEach((seg, i) => expect(seg).toEqual(finalSegs[i]));
    }
    // Segments tile the text with no gaps.
    expect(finalSegs[0]!.start).toBe(0);
    for (let i = 1; i < finalSegs.length; i++) expect(finalSegs[i]!.start).toBe(finalSegs[i - 1]!.end);
    expect(finalSegs.at(-1)!.end).toBe(full.length);
  });

  it("does not split on abbreviations, initials or decimals", () => {
    const t = "Mr. Renn spoke to Sgt. P. Holm. The value was 2.4 million crowns, give or take a little.";
    expect(texts(t, true)).toEqual(["Mr. Renn spoke to Sgt. P. Holm.", "The value was 2.4 million crowns, give or take a little."]);
  });

  it("keeps closing quotes with their sentence", () => {
    expect(texts('He said, "It was her." Then he sat down on the stairs and waited.', true)).toEqual([
      'He said, "It was her."',
      "Then he sat down on the stairs and waited.",
    ]);
  });

  it("cuts a run-on sentence at a clause break", () => {
    const clause = "and then the lights went out on the upper flight of the east stairwell";
    const t = `First. ${Array.from({ length: 6 }, () => clause).join(", ")}.`;
    const segs = texts(t, true);
    expect(segs.length).toBeGreaterThan(2);
    for (const s of segs.slice(1)) expect(s.length).toBeLessThan(320);
  });

  it("treats a paragraph break as a sentence end", () => {
    expect(texts("Members of the jury\n\nthe evidence will show three things about that night.", true)).toEqual([
      "Members of the jury",
      "the evidence will show three things about that night.",
    ]);
  });

  it("joins short sentences up to the minimum length", () => {
    const segs = texts("Overruled. Answer it. Go on. You may answer the question, Mr Renn.", true);
    expect(segs[0]).toBe("Overruled.");
    for (const s of segs.slice(1, -1)) expect(s.length).toBeGreaterThanOrEqual(MIN_SEGMENT_CHARS);
  });

  it("returns nothing for empty or blank text", () => {
    expect(splitSpeech("", true)).toEqual([]);
    expect(splitSpeech("   ", true)).toEqual([]);
  });
});

describe("cleanForSpeech", () => {
  it("drops stage directions and citations", () => {
    expect(cleanForSpeech("*clears throat* I know what I saw.")).toBe("I know what I saw.");
    expect(cleanForSpeech("I was (pauses) at the desk.")).toBe("I was at the desk.");
    expect(cleanForSpeech("She was told in writing (E4).")).toBe("She was told in writing.");
    expect(cleanForSpeech("[violation:leading] Wasn't it?")).toBe("Wasn't it?");
  });

  it("keeps bold words but drops the markup", () => {
    expect(cleanForSpeech("That is **not** what I said.")).toBe("That is not what I said.");
  });

  it("spells out exhibit ids and door codes", () => {
    expect(cleanForSpeech("Look at Exhibit E6 and E10.")).toBe("Look at Exhibit E six and E ten.");
    expect(cleanForSpeech("Service door SD-3 was open.")).toBe("Service door S D 3 was open.");
  });

  it("leaves ordinary text, times and numbers alone", () => {
    const t = "At 11:44 pm, he rang the police; 6.5 million crowns, Ms Arden.";
    expect(cleanForSpeech(t)).toBe(t);
  });

  it("returns empty when nothing speakable is left", () => {
    expect(cleanForSpeech("(nods)")).toBe("");
    expect(cleanForSpeech("*silence* ...")).toBe("");
  });

  it("collapses whitespace and stray punctuation left by removals", () => {
    expect(cleanForSpeech("Yes (E3) , sir .")).toBe("Yes, sir.");
    expect(cleanForSpeech("Members of the jury\n\n- the badge log")).toBe("Members of the jury the badge log");
  });
});
