/**
 * One trial, played on the stage. All game state comes from the view; this file only decides
 * what the stage shows for the beat the presenter is currently playing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ObjectionType, Phase, PlayerView, RecordEntry } from "../../src/shared/types";
import type { Mood, Pose } from "./art/Character";
import { phaseWitness, type CaseInfo } from "./labels";
import { CaseFile, type CaseTab } from "./overlays/CaseFile";
import { EvidencePicker } from "./overlays/EvidencePicker";
import { TranscriptLog } from "./overlays/TranscriptLog";
import { JuryRoom } from "./screens/JuryRoom";
import { BeginCard, ObjectionPad, QuestionBar, SpeechPad } from "./stage/Controls";
import { actorHead, cameraFor, Courtroom, standChangeMs, toScreen, type CourtState } from "./stage/Courtroom";
import { Bubble, Caption, speakerKey, Thinking } from "./stage/Dialogue";
import { CrackBurst, ObjectionShout, RulingStamp, rulingOf } from "./stage/Effects";
import { Hud } from "./stage/Hud";
import { StageFrame } from "./stage/StageFrame";
import { StageToasts } from "./stage/Toasts";
import { VerdictBoard } from "./stage/Verdict";
import { usePresenter, type Beat, type Timing } from "./usePresenter";
import type { TrialHandle } from "./useTrial";
import { isTypingTarget, prefersReducedMotion } from "./util";
import { voicePlayer } from "./voice/player";
import { voiceSettings, useVoiceSettings } from "./voice/settings";
import { useDictation } from "./voice/useDictation";
import { ListeningBadge, VoiceHudControls } from "./voice/VoiceUi";

const AUTO_KEY = "trial-sim:auto";

const standFor = (phase: Phase, info: CaseInfo): string | null => phaseWitness(phase, info)?.id ?? null;

const EXAMINER: Partial<Record<Phase, "player" | "prosecutor">> = {
  w1_direct: "prosecutor",
  w2_direct: "prosecutor",
  w3_cross: "prosecutor",
  w1_cross: "player",
  w2_cross: "player",
};

function crackOf(b: Pick<Beat, "tags">) {
  return b.tags.some((t) => t.type === "lie_cracked");
}

/** Who the court is waiting on, so silence shows as someone thinking. */
function nextUp(beat: Beat | null, phase: Phase, stand: string | null): string | null {
  if (!beat) return phase === "opening" ? "prosecutor" : null;
  switch (beat.kind) {
    case "question":
      return stand ? `w:${stand}` : null;
    case "objection":
      return "judge";
    case "ruling":
      return rulingOf(beat.tags)?.sustained ? (EXAMINER[phase] === "prosecutor" ? "prosecutor" : null) : stand ? `w:${stand}` : null;
    case "answer":
      return EXAMINER[phase] === "prosecutor" ? "prosecutor" : null;
    case "narration":
      return EXAMINER[phase] === "prosecutor" ? "prosecutor" : null;
    case "statement":
      return beat.speaker.kind === "player" ? "judge" : null;
  }
}

export function TrialScreen({ trial, view, onLeave }: { trial: TrialHandle; view: PlayerView; onLeave: () => void }) {
  const info = view.caseInfo;
  const defendantId = info.witnesses[2]?.id ?? "";
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_KEY) !== "0");
  const [caseOpen, setCaseOpen] = useState(view.phase === "case_review");
  const [caseTab, setCaseTab] = useState<CaseTab>("brief");
  const [caseExhibit, setCaseExhibit] = useState(info.evidence[0]?.id ?? "");
  const [logOpen, setLogOpen] = useState<{ highlight: string | null } | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [drafts, setDrafts] = useState({ opening: "", closing: "", question: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [juryRoom, setJuryRoom] = useState(false);

  useEffect(() => localStorage.setItem(AUTO_KEY, auto ? "1" : "0"), [auto]);

  // ── presentation timing ──
  const beatsRef = useRef<Beat[]>([]);
  const timing = useMemo<Timing>(
    () => ({
      lead: (b) => (b.kind === "objection" ? 950 : b.kind === "ruling" && rulingOf(b.tags) ? 700 : 0),
      hold: (b) => {
        let ms = 0;
        if (crackOf(b)) ms += 1800;
        if (b.kind === "ruling") ms += 400;
        const prev = [...beatsRef.current].reverse().find((x) => x.n < b.n);
        const from = standFor(prev?.phase ?? "opening", info);
        const to = standFor(b.phase, info);
        if (from !== to) ms = Math.max(ms, standChangeMs(from, to, defendantId) - 1500);
        return ms;
      },
    }),
    // caseInfo is a fresh object on every state event; the case itself never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info.title, defendantId],
  );
  // ── voice ──
  const voiceState = useVoiceSettings();
  const busyNow = trial.awaiting !== null;
  const freeTextTurn = !busyNow && (view.pending === "question" || view.pending === "opening" || view.pending === "closing");
  const dictation = useDictation(view.id, freeTextTurn);
  const recording = dictation.phase === "recording" || dictation.phase === "starting";
  const voiceOn = voiceState.tts === true && voiceState.enabled && !voiceState.locked && dictation.phase === "idle";
  const voiceOpts = useMemo(() => ({ player: voicePlayer, on: voiceOn }), [voiceOn]);

  const pr = usePresenter(trial, { auto, timing, voice: voiceOpts });
  beatsRef.current = pr.beats;
  const beat = pr.beat;

  const busy = trial.awaiting !== null;
  const verdictMode = view.phase === "verdict" && pr.drained;
  // Controls wait for the queue to drain. A speech pad covers the stage, so it also waits
  // until the last line has had its reading time (or the player clicked past it).
  const speechTurn = view.pending === "opening" || view.pending === "closing";
  const pending = busy || !pr.drained || verdictMode || (speechTurn && !pr.lingering && pr.beat !== null) ? null : view.pending;
  const continueHint = pr.canContinue || (speechTurn && !busy && pr.done && !pr.lingering);
  const presentedPhase: Phase = pr.phase;
  const stand = standFor(presentedPhase, info);
  const examiner = EXAMINER[presentedPhase];

  // Exhibit selection belongs to one cross-examination.
  useEffect(() => setSelected([]), [view.witnessId, view.phase]);

  // ── overlays and keys ──
  const anyOverlay = caseOpen || logOpen !== null || evidenceOpen || juryRoom;
  const openExhibit = useCallback((id: string) => {
    setEvidenceOpen(false);
    setLogOpen(null);
    setCaseTab("exhibits");
    setCaseExhibit(id);
    setCaseOpen(true);
  }, []);

  const advance = pr.advance;
  // Space / Enter / click also hurry the verdict reveal along.
  const skipVerdictRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector(".modal-root") || juryRoom) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        e.preventDefault();
        setCaseOpen(true);
      } else if (k === "t") {
        e.preventDefault();
        setLogOpen({ highlight: null });
      } else if (k === "a") {
        e.preventDefault();
        setAuto((a) => !a);
      } else if (k === "v" && voiceSettings.get().tts) {
        e.preventDefault();
        voiceSettings.setEnabled(!voiceSettings.get().enabled);
      } else if (k === "e" && pending === "question") {
        e.preventDefault();
        setEvidenceOpen(true);
      } else if ((e.key === " " || e.key === "Enter") && (e.target === document.body || (e.target as HTMLElement).closest?.(".stage-click"))) {
        e.preventDefault();
        if (skipVerdictRef.current) skipVerdictRef.current();
        else advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, pending, juryRoom]);

  // ── actions ──
  const say = async (kind: "opening" | "closing") => {
    const text = drafts[kind].trim();
    if (await trial.act({ type: kind, text })) setDrafts((d) => ({ ...d, [kind]: "" }));
  };
  const ask = async () => {
    const text = drafts.question.trim();
    if (await trial.act({ type: "ask", text, exhibitIds: selected })) {
      setDrafts((d) => ({ ...d, question: "" }));
      setSelected([]);
    }
  };
  const object = useCallback((ground: ObjectionType) => void trial.act({ type: "object", ground }), [trial]);
  const pass = useCallback(() => void trial.act({ type: "pass" }), [trial]);

  // ── the judge's gavel, struck on rulings ──
  const [gavel, setGavel] = useState<"up" | "down" | null>(null);
  const rulingKey = beat && beat.kind === "ruling" && rulingOf(beat.tags) && !pr.isInitial ? beat.key : null;
  useEffect(() => {
    if (!rulingKey) return;
    setGavel("up");
    const t1 = setTimeout(() => setGavel("down"), 420);
    const t2 = setTimeout(() => setGavel(null), 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [rulingKey]);

  // ── verdict reveal ──
  const [revealed, setRevealed] = useState(0);
  const votes = view.result?.verdict.votes ?? [];
  const jurorIndex = (id: string) => info.jurors.findIndex((j) => j.id === id);
  useEffect(() => {
    if (!verdictMode || !view.result) return;
    if (revealed > votes.length) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), revealed === 0 ? 1400 : revealed === votes.length ? 1300 : 1500);
    return () => clearTimeout(t);
  }, [verdictMode, view.result, revealed, votes.length]);
  const outcomeShown = verdictMode && !!view.result && revealed > votes.length;
  skipVerdictRef.current = verdictMode && view.result && !outcomeShown ? () => setRevealed(votes.length + 1) : null;

  // ── who looks how ──
  const presentedCracks = useMemo(() => {
    const out = new Set<string>();
    for (const b of pr.beats) {
      if (b.n > pr.presentedUpTo) break;
      for (const t of b.tags) if (t.type === "lie_cracked") out.add(t.witnessId);
    }
    return out;
  }, [pr.beats, pr.presentedUpTo]);

  const speakerK = beat ? speakerKey(beat) : null;
  const focus: string | null =
    pending === "opening" || pending === "closing"
      ? "player"
      : verdictMode
        ? null
        : speakerK && speakerK !== "clerk"
          ? speakerK
          : null;

  const moods: Record<string, Mood | undefined> = {};
  const poses: Record<string, Pose | undefined> = {};
  for (const id of presentedCracks) moods[`w:${id}`] = id === defendantId ? "sad" : "broken";
  if (beat && !pr.isInitial) {
    const k = speakerKey(beat);
    if (beat.kind === "objection") {
      poses[k] = "raise";
      moods[k] = "stern";
    }
    if (beat.kind === "answer" && crackOf(beat)) moods[k] = pr.done ? "broken" : "shocked";
    const r = beat.kind === "ruling" ? rulingOf(beat.tags) : null;
    if (r) {
      const objector = r.by === "defence" ? "player" : "prosecutor";
      const other = objector === "player" ? "prosecutor" : "player";
      moods[objector] = r.sustained ? (objector === "player" ? "happy" : "smug") : "neutral";
      moods[other] = r.sustained ? "neutral" : objector === "player" ? "smug" : "happy";
    }
    if (beat.speaker.kind === "witness" && !pr.done) poses[k] = "gesture";
    if ((beat.speaker.kind === "player" || beat.speaker.kind === "prosecutor") && beat.kind !== "objection" && !pr.done) poses[k] = "gesture";
  }
  if (gavel) poses.judge = gavel === "up" ? "gavelUp" : "gavelDown";
  if (recording) poses.player = "gesture";
  if (pending === "opening" || pending === "closing") moods.player = "focused";
  if (outcomeShown && view.result) {
    const o = view.result.verdict.outcome;
    moods[`w:${defendantId}`] = o === "not_guilty" ? "happy" : o === "guilty" ? "sad" : "anxious";
    moods.player = o === "not_guilty" ? "happy" : o === "guilty" ? "sad" : "neutral";
  }
  if (verdictMode) poses[`w:${defendantId}`] = "clasp";

  const jurorsUp = info.jurors.map((j) => verdictMode && votes.some((v, i) => v.jurorId === j.id && i < revealed));
  const noisy = beat && !pr.isInitial && (beat.kind === "objection" || (beat.kind === "ruling" && rulingOf(beat.tags)) || crackOf(beat));

  const court: CourtState = {
    inSession: presentedPhase !== "case_review",
    stand,
    witnessIds: info.witnesses.map((w) => w.id),
    defendantId,
    jurorIds: info.jurors.map((j) => j.id),
    judgeName: info.judgeName,
    standName: stand ? info.witnesses.find((w) => w.id === stand)?.name.split(" ").slice(-1)[0] ?? null : null,
    speaker: focus,
    // Whose mouth moves: the player while dictating; otherwise the speaker while their audio
    // plays (voiced) or their line types out (text only).
    talker: recording ? "player" : beat && pr.speaking && !pr.isInitial ? speakerKey(beat) : null,
    up: {
      player: examiner === "player" || focus === "player" || (beat?.speaker.kind === "player" && !pr.done) || pending === "question" || recording,
      prosecutor: examiner === "prosecutor" || beat?.speaker.kind === "prosecutor",
    },
    moods,
    poses,
    jurorsUp,
    startle: noisy ? beat!.n : 0,
    freeze: pending === "objection_window",
    push: focus !== null && pending !== "question",
  };
  const cam = cameraFor(court);

  const struckQuestion: RecordEntry | null = useMemo(() => {
    if (!beat || beat.kind !== "ruling") return null;
    return [...view.record].reverse().find((e) => Number(e.id.slice(1)) < beat.n && e.kind === "question" && e.stricken) ?? null;
  }, [beat, view.record]);

  const lies = view.exposedLies.filter((l) => {
    const b = pr.beats.find((x) => x.tags.some((t) => t.type === "lie_cracked" && t.lieId === l.lieId));
    if (!b) return true;
    return b.n < pr.presentedUpTo || (b.n === pr.presentedUpTo && pr.done);
  });

  // Questions-left pips: remember the budget at the start of each cross.
  const totals = useRef<Record<string, number>>({});
  if (view.pending === "question" && totals.current[view.phase] === undefined) totals.current[view.phase] = Math.max(view.questionsLeft, 1);
  const total = Math.max(totals.current[view.phase] ?? view.questionsLeft, view.questionsLeft);

  const witnessName = stand ? info.witnesses.find((w) => w.id === stand)?.name ?? "the witness" : "the witness";
  const thinker = pr.drained && view.pending === null && view.phase !== "verdict" && view.phase !== "case_review" && !busy ? nextUp(beat, presentedPhase, stand) : null;

  let controls = null;
  if (view.phase === "case_review" && !caseOpen) {
    controls = <BeginCard onCaseFile={() => setCaseOpen(true)} onBegin={() => void trial.act({ type: "begin" })} busy={busy} ready={view.pending === "begin"} />;
  } else if (pending === "opening" || pending === "closing") {
    controls = (
      <SpeechPad
        key={pending}
        kind={pending}
        value={drafts[pending]}
        onChange={(v) => setDrafts((d) => ({ ...d, [pending]: v }))}
        onSubmit={() => void say(pending)}
        busy={busy}
        dictation={dictation}
      />
    );
  } else if (pending === "question") {
    controls = (
      <QuestionBar
        key={`q-${view.record.length}`}
        info={info}
        witnessName={witnessName}
        left={view.questionsLeft}
        total={total}
        value={drafts.question}
        onChange={(v) => setDrafts((d) => ({ ...d, question: v }))}
        attached={selected}
        onDetach={(id) => setSelected((s) => s.filter((x) => x !== id))}
        onEvidence={() => setEvidenceOpen(true)}
        onAsk={() => void ask()}
        onEnd={() => void trial.act({ type: "end_cross" })}
        busy={busy}
        dictation={dictation}
      />
    );
  } else if (pending === "objection_window") {
    controls = <ObjectionPad key={`o-${beat?.key}`} info={info} onObject={object} onPass={pass} busy={busy} />;
  }

  const showBubble = beat && !verdictMode && !(pending === "opening" || pending === "closing") && view.phase !== "case_review";

  const overlay = (
    <>
      <div className="stage-click" onClick={() => (skipVerdictRef.current ? skipVerdictRef.current() : advance())} tabIndex={-1} aria-hidden />
      {beat && !pr.isInitial && beat.kind === "objection" && <ObjectionShout key={`s${beat.key}`} beat={beat} info={info} />}
      {beat && !pr.isInitial && beat.kind === "ruling" && <RulingStamp key={`r${beat.key}`} beat={beat} info={info} struck={struckQuestion} />}
      {beat && !pr.isInitial && beat.ended && crackOf(beat) && <CrackBurst key={`c${beat.key}`} beat={beat} />}
      {showBubble && beat.speaker.kind === "clerk" && <Caption beat={beat} reveal={pr.reveal} done={pr.done} canContinue={continueHint} />}
      {showBubble && beat.speaker.kind !== "clerk" && (
        <Bubble
          beat={beat}
          reveal={pr.reveal}
          info={info}
          court={court}
          cam={cam}
          canContinue={continueHint}
          done={pr.done}
          onExhibit={openExhibit}
          struck={beat.stricken}
        />
      )}
      {thinker && !recording && <Thinking who={thinker} court={court} cam={cam} />}
      {recording && (() => {
        const head = toScreen(cam, actorHead("player", court));
        // To the left of the lawyer's head: the speech pad covers the stage to the right.
        return <ListeningBadge x={head.x + 34} y={head.y - 64} level={dictation.level} />;
      })()}
      {view.phase === "verdict" && pr.drained && !view.result && (
        <div className="caption deliberating">
          <span className="caption-kicker">The jury is out</span>
          <p>The jurors are deliberating…</p>
        </div>
      )}
      {verdictMode && view.result && (
        <VerdictBoard
          info={info}
          result={view.result}
          revealed={revealed}
          outcomeShown={outcomeShown}
          onSkip={() => setRevealed(votes.length + 1)}
          onJuryRoom={() => setJuryRoom(true)}
          onNewTrial={onLeave}
          jurorIndex={jurorIndex}
        />
      )}
      <Hud
        view={view}
        phase={verdictMode ? "verdict" : presentedPhase}
        lies={lies}
        auto={auto}
        onAuto={() => setAuto((a) => !a)}
        onCaseFile={() => setCaseOpen(true)}
        onLog={() => setLogOpen({ highlight: null })}
        connection={trial.connection}
        voice={<VoiceHudControls s={voiceState} />}
      />
      {controls}
      <StageToasts notices={trial.notices} errors={trial.errors} onDismissError={trial.dismissError} onDismissNotice={trial.dismissNotice} />
    </>
  );

  if (juryRoom && view.result) {
    return (
      <>
        <JuryRoom
          view={view}
          onBack={() => setJuryRoom(false)}
          onNewTrial={onLeave}
          onEntry={(id) => setLogOpen({ highlight: id })}
        />
        {logOpen && <TranscriptLog record={view.record} info={info} onClose={() => setLogOpen(null)} onExhibit={openExhibit} highlight={logOpen.highlight} />}
        {caseOpen && (
          <CaseFile info={info} admitted={view.admitted} tab={caseTab} onTab={setCaseTab} exhibit={caseExhibit} onExhibit={setCaseExhibit} onClose={() => setCaseOpen(false)} />
        )}
      </>
    );
  }

  return (
    <>
      <StageFrame className={`${anyOverlay ? "dimmed" : ""}${prefersReducedMotion() ? " reduced" : ""}`}>
        <Courtroom s={court} overlay={overlay} />
      </StageFrame>
      {caseOpen && (
        <CaseFile
          info={info}
          admitted={view.admitted}
          tab={caseTab}
          onTab={setCaseTab}
          exhibit={caseExhibit}
          onExhibit={setCaseExhibit}
          onClose={() => setCaseOpen(false)}
          footer={
            view.phase === "case_review" ? (
              <>
                <span className="binder-foot-note">The file stays one key away during the trial: press C.</span>
                <button
                  type="button"
                  className="btn primary large"
                  disabled={view.pending !== "begin" || busy}
                  onClick={() => {
                    setCaseOpen(false);
                    void trial.act({ type: "begin" });
                  }}
                >
                  {busy ? "All rise…" : "Proceed to trial"}
                </button>
              </>
            ) : undefined
          }
        />
      )}
      {logOpen && (
        <TranscriptLog record={view.record} info={info} onClose={() => setLogOpen(null)} onExhibit={openExhibit} highlight={logOpen.highlight} upTo={pr.presentedUpTo} />
      )}
      {evidenceOpen && (
        <EvidencePicker
          info={info}
          admitted={view.admitted}
          selected={selected}
          witnessName={witnessName}
          onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
          onClose={() => {
            setEvidenceOpen(false);
            requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".qbar-input")?.focus({ preventScroll: true }));
          }}
        />
      )}
    </>
  );
}
