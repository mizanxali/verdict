import { describe, expect, it } from "vitest";
import { insertAt } from "./text";

describe("insertAt (dictation lands at the cursor)", () => {
  it("fills an empty field", () => {
    expect(insertAt("", "Where were you?", 0, 0)).toEqual({ value: "Where were you?", caret: 15 });
  });
  it("appends a second take with a space", () => {
    expect(insertAt("Members of the jury.", "You heard Mr Renn.", 20, 20).value).toBe("Members of the jury. You heard Mr Renn.");
  });
  it("inserts mid-text with spaces on both sides and puts the caret after it", () => {
    const r = insertAt("Look at E6 please", "the maintenance log,", 8, 8);
    expect(r.value).toBe("Look at the maintenance log, E6 please");
    expect(r.value.slice(0, r.caret)).toBe("Look at the maintenance log,");
  });
  it("replaces a selection and does not double spaces", () => {
    expect(insertAt("Ask about the door now.", "SD-3", 14, 18)).toEqual({ value: "Ask about the SD-3 now.", caret: 18 });
  });
  it("does not add a space before punctuation that follows", () => {
    expect(insertAt("Is that right?", ", Mr Renn", 13, 13).value).toBe("Is that right, Mr Renn?");
  });
});
