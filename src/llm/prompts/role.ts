/**
 * The role-specific tail of a request. It always comes after the shared, cached prefix:
 * `cue` is a short user turn (the thing to respond to) and `instructions` is the part's brief,
 * sent as a mid-conversation system message after it. Private knowledge lives only here.
 */
export interface RolePrompt {
  /** UsageEntry.call, e.g. "actor:witness:renn", "scorer:jury". */
  call: string;
  kind: "actor" | "scorer";
  cue: string;
  instructions: string;
}

export const bullets = (items: readonly string[]) => items.map((s) => `- ${s}`).join("\n");
