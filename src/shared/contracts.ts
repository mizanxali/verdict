/**
 * Module boundaries. Owned by the orchestrator; do not edit (report needed changes).
 *
 *   cases/   exports loadCase()                      -> CaseFile
 *   llm/     exports createLlm()                     -> Llm          (real Anthropic calls)
 *   shared/  exports createFakeLlm()                 -> Llm          (deterministic, free)
 *   engine/  exports createTrial(), toPlayerView()   -> TrialEngine  (owns ALL state)
 *   server/  wires them together over HTTP + SSE for web/
 *   harness/ drives the engine headlessly for full trials and regression transcripts
 */
import type {
  Budgets,
  CaseFile,
  Confront,
  EventTag,
  FactCheck,
  LeakCheck,
  ObjectionType,
  PlayerAction,
  PlayerView,
  RecordEntry,
  RuleCheck,
  Ruling,
  JuryUpdate,
  Side,
  TrialEvent,
  TrialState,
  UsageEntry,
} from "./types";

// ───────────────────────── LLM boundary ─────────────────────────

/**
 * Shared by every call. The llm layer turns this into the cached prompt prefix:
 * system = fixed rules of the game + PUBLIC case file; first user message = the record so far.
 * The role-specific part (persona, private knowledge, task) always comes LAST, so every role
 * shares one prefix cache. Nothing from caseFile.timeline, witnesses[].lies, witnesses[].knows,
 * witnesses[].persona, jurors[].disposition or prosecution.* belongs in the shared prefix.
 */
export interface LlmContext {
  caseFile: CaseFile;
  /** The public record so far. Stricken entries are included and marked. */
  record: RecordEntry[];
}

/** Private knowledge for a witness actor, selected by the ENGINE. The actor sees nothing else. */
export interface WitnessBrief {
  witnessId: string;
  name: string;
  role: string;
  persona: string;
  publicStatement: string;
  knows: string[];
  lies: {
    id: string;
    topic: string;
    status: "held" | "cracked";
    coverStory: string;
    /** Present only when status === "cracked". */
    truth?: string;
    concession?: string;
    /** True on the single turn where the lie breaks: the witness must concede now. */
    justCracked: boolean;
  }[];
}

export type ActorRequest =
  | {
      role: "witness";
      brief: WitnessBrief;
      examiner: Side;
      mode: "direct" | "cross";
      question: RecordEntry;
    }
  | {
      role: "prosecutor";
      task: "question";
      witnessId: string;
      mode: "direct" | "cross";
      /** From caseFile.prosecution.plan. The engine attaches step.exhibitIds itself. */
      step: { topic: string; exhibitIds: string[] };
      questionsLeft: number;
    }
  | { role: "prosecutor"; task: "opening" | "closing" }
  | {
      role: "judge";
      task: "ruling_line";
      ruling: Ruling;
      objector: Side;
    };

export interface ActorResult {
  text: string;
  /** stop_reason was "refusal" (or the call failed). text may be empty or partial: discard it. */
  refused: boolean;
}

export interface FactCheckRequest {
  speaker: Side;
  entry: RecordEntry; // the statement or question being checked (not yet in ctx.record)
  /** Exhibits this speaker may rely on right now. Anything else is not in the record. */
  allowedExhibitIds: string[];
}

export interface RuleCheckRequest {
  speaker: Side;
  entry: RecordEntry;
  mode: "direct" | "cross";
  witnessId: string;
}

export interface RulingRequest {
  objector: Side;
  ground: ObjectionType;
  entry: RecordEntry; // the question objected to
  mode: "direct" | "cross";
  witnessId: string;
  /** Premises of the question the fact-checker already found are not in the record.
   *  Code-established; the judge takes them as given when the ground is assumes_facts. */
  flaggedClaims?: { text: string; verdict: "unsupported" | "contradicted" }[];
}

export interface ConfrontRequest {
  witnessId: string;
  lieId: string;
  /** Public description of the cover story being challenged and what must be put to the witness. */
  coverStory: string;
  mustConfront: string;
  exhibitIds: string[];
  entry: RecordEntry;
}

export interface JuryUpdateRequest {
  /** The entries of this exchange (also the tail of ctx.record). */
  exchange: RecordEntry[];
  /** Code-established events for this exchange. The scorer may not invent others. */
  tags: EventTag[];
  jurors: { id: string; name: string; persona: string; disposition: string; lean: number }[];
}

/** Used by the regression harness only; never affects a live trial. */
export interface LeakCheckRequest {
  witnessName: string;
  heldLies: { id: string; coverStory: string; truth: string }[];
  question: RecordEntry;
  answer: RecordEntry;
}

/**
 * Scorers return null when the call was refused or failed after one retry. The engine treats
 * null as "no effect" and carries on. Scorers never throw for refusals.
 * actor() streams text through onToken and resolves with the full text.
 */
export interface Llm {
  actor(ctx: LlmContext, req: ActorRequest, onToken: (text: string) => void, signal?: AbortSignal): Promise<ActorResult>;
  factCheck(ctx: LlmContext, req: FactCheckRequest): Promise<FactCheck | null>;
  ruleCheck(ctx: LlmContext, req: RuleCheckRequest): Promise<RuleCheck | null>;
  ruling(ctx: LlmContext, req: RulingRequest): Promise<Ruling | null>;
  confront(ctx: LlmContext, req: ConfrontRequest): Promise<Confront | null>;
  juryUpdate(ctx: LlmContext, req: JuryUpdateRequest): Promise<JuryUpdate | null>;
  leakCheck(ctx: LlmContext, req: LeakCheckRequest): Promise<LeakCheck | null>;
  /** Set by the engine. Called once per API call, including refused and retried ones. */
  onUsage?: (entry: UsageEntry) => void;
}

// ───────────────────────── Engine boundary ─────────────────────────

export interface CreateTrialOptions {
  caseFile: CaseFile;
  llm: Llm;
  /** Receives every event, including those from background scoring after act() resolves. */
  emit: (event: TrialEvent) => void;
  budgets?: Partial<Budgets>;
  id?: string;
  /** Resume a saved trial. Only valid for a state whose pending !== null or phase === "verdict". */
  state?: TrialState;
}

export interface TrialEngine {
  readonly state: TrialState;
  view(): PlayerView;
  /**
   * Applies one player action and runs the trial forward until the player's input is needed
   * again (state.pending !== null) or the verdict is reached. Rejects with InvalidActionError
   * if the action does not match state.pending, and never mutates state in that case.
   * Only one act() may run at a time.
   */
  act(action: PlayerAction): Promise<void>;
  /** Resolves when all background scoring (jury updates) has been applied. */
  idle(): Promise<void>;
}

export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidActionError";
  }
}

export type CreateTrial = (opts: CreateTrialOptions) => TrialEngine;
export type ToPlayerView = (state: TrialState, caseFile: CaseFile) => PlayerView;
export type LoadCase = (id?: string) => CaseFile;
export type CreateLlm = (opts?: { apiKey?: string }) => Llm;
