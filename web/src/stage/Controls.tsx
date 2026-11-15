/** The player's controls along the bottom of the stage. Only one is ever shown. */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { ObjectionType } from "../../../src/shared/types";
import { MAX_TEXT } from "../api";
import { IconDoc } from "../art/Icons";
import type { CaseInfo } from "../labels";
import { isTypingTarget } from "../util";
import { insertAt } from "../voice/text";
import type { Dictation } from "../voice/useDictation";
import { DictationStatus, MicButton } from "../voice/VoiceUi";

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function Counter({ n }: { n: number }) {
  const cls = n > MAX_TEXT ? "over" : n > MAX_TEXT * 0.85 ? "near" : "";
  return (
    <span className={`counter ${cls}`} aria-live="polite">
      {n} / {MAX_TEXT}
    </span>
  );
}

/** Lets dictation drop text into this textarea at its cursor (never submitting it). */
function useDictationTarget(d: Dictation | undefined, ref: RefObject<HTMLTextAreaElement | null>, value: string, onChange: (v: string) => void) {
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const setTarget = d?.setTarget;
  useEffect(() => {
    if (!setTarget) return;
    setTarget({
      insert: (text) => {
        const el = ref.current;
        const v = latest.current.value;
        const r = insertAt(v, text, el?.selectionStart ?? v.length, el?.selectionEnd ?? v.length);
        latest.current.onChange(r.value);
        requestAnimationFrame(() => {
          if (!el) return;
          el.focus({ preventScroll: true });
          el.setSelectionRange(r.caret, r.caret);
          el.classList.remove("dictated");
          void el.offsetWidth; // restart the highlight animation
          el.classList.add("dictated");
        });
      },
    });
    return () => setTarget(null);
  }, [setTarget, ref]);
}

export function Pips({ left, total }: { left: number; total: number }) {
  return (
    <span className="pips" role="img" aria-label={`${left} of ${total} questions left`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < left ? "on" : ""} />
      ))}
    </span>
  );
}

export function QuestionBar({
  info,
  witnessName,
  left,
  total,
  value,
  onChange,
  attached,
  onDetach,
  onEvidence,
  onAsk,
  onEnd,
  busy,
  dictation,
}: {
  info: CaseInfo;
  witnessName: string;
  left: number;
  total: number;
  value: string;
  onChange: (v: string) => void;
  attached: string[];
  onDetach: (id: string) => void;
  onEvidence: () => void;
  onAsk: () => void;
  onEnd: () => void;
  busy: boolean;
  dictation?: Dictation;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  useDictationTarget(dictation, ref, value, onChange);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (!confirmEnd) return;
    const t = setTimeout(() => setConfirmEnd(false), 4000);
    return () => clearTimeout(t);
  }, [confirmEnd]);
  const ok = value.trim().length > 0 && value.trim().length <= MAX_TEXT && !busy;
  const ask = () => ok && onAsk();
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "e" || e.key === "E") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onEvidence();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask();
    }
  };
  return (
    <div className="controls qbar" onClick={stop} role="group" aria-label={`Cross-examine ${witnessName}`}>
      <div className="qbar-top">
        <span className="qbar-title">
          Your question to <b>{witnessName}</b>
        </span>
        <Pips left={left} total={total} />
        <span className="qbar-left">
          {left} {left === 1 ? "question" : "questions"} left
        </span>
        <span className="qbar-chips">
          {attached.map((id) => {
            const ex = info.evidence.find((e) => e.id === id);
            return (
              <span key={id} className="attached-chip">
                <IconDoc /> <b>{id}</b> {ex?.title}
                <button type="button" aria-label={`Remove ${id}`} onClick={() => onDetach(id)}>
                  ×
                </button>
              </span>
            );
          })}
        </span>
      </div>
      <div className="qbar-row">
        <button type="button" className="btn evidence-btn" onClick={onEvidence} disabled={busy} aria-keyshortcuts="E Control+E Meta+E" title="E, or Ctrl/⌘+E while typing">
          <IconDoc /> Present evidence{attached.length ? ` (${attached.length})` : ""} <span className="kbd-hint">⌘E</span>
        </button>
        <textarea
          ref={ref}
          className="qbar-input"
          value={value}
          maxLength={MAX_TEXT}
          disabled={busy}
          rows={2}
          placeholder={attached.length ? `Put ${attached.join(", ")} to the witness…` : `Ask ${witnessName} a question…`}
          aria-label="Your question"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
        />
        {dictation && <MicButton d={dictation} disabled={busy} />}
        <div className="qbar-actions">
          <button type="button" className="btn primary ask-btn" disabled={!ok} onClick={ask}>
            Ask <span className="kbd-hint">Enter</span>
          </button>
          <button type="button" className={`btn ghost small end-btn${confirmEnd ? " confirm" : ""}`} disabled={busy} onClick={() => (confirmEnd ? onEnd() : setConfirmEnd(true))}>
            {confirmEnd ? "Confirm: no further questions" : "No further questions"}
          </button>
        </div>
      </div>
      <div className="qbar-foot">
        <Counter n={value.length} />
        {dictation?.notice ? (
          <DictationStatus d={dictation} />
        ) : (
          <span className="hint">
            <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
            {dictation?.available && (
              <>
                {" · hold "}
                <kbd>Alt</kbd> to dictate
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export function ObjectionPad({
  info,
  onObject,
  onPass,
  busy,
}: {
  info: CaseInfo;
  onObject: (g: ObjectionType) => void;
  onPass: () => void;
  busy: boolean;
}) {
  const passRef = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<number | null>(null);
  useEffect(() => passRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (busy || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector(".modal-root")) return;
      const n = Number(e.key);
      const o = Number.isInteger(n) && n >= 1 ? info.rules.objections[n - 1] : undefined;
      if (o) {
        e.preventDefault();
        onObject(o.type);
      } else if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        onPass();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, info, onObject, onPass]);

  const shown = tip !== null ? info.rules.objections[tip] : undefined;
  return (
    <div className="controls objpad" onClick={stop} role="group" aria-label="Object, or let the question stand">
      <div className="objpad-head">
        <span className="objpad-call">Object?</span>
        <span className="objpad-sub">Call it before the witness answers. A groundless objection costs credibility.</span>
      </div>
      <div className="objpad-row">
        {info.rules.objections.map((o, i) => (
          <button
            key={o.type}
            type="button"
            className="obj-btn"
            style={{ animationDelay: `${i * 35}ms` }}
            disabled={busy}
            aria-keyshortcuts={String(i + 1)}
            aria-describedby={tip === i ? "obj-tip" : undefined}
            onMouseEnter={() => setTip(i)}
            onMouseLeave={() => setTip((t) => (t === i ? null : t))}
            onFocus={() => setTip(i)}
            onBlur={() => setTip((t) => (t === i ? null : t))}
            onClick={() => onObject(o.type)}
          >
            <span className="obj-key">{i + 1}</span>
            <span className="obj-name">{o.name}</span>
          </button>
        ))}
        <button ref={passRef} type="button" className="obj-pass" disabled={busy} onClick={onPass} aria-keyshortcuts="L">
          Let it stand <span className="obj-key">L</span>
        </button>
      </div>
      {shown && (
        <div className="obj-tip" id="obj-tip" role="tooltip">
          <b>{shown.name}.</b> {shown.rule} <i>e.g. {shown.example}</i>
        </div>
      )}
    </div>
  );
}

export function SpeechPad({
  kind,
  value,
  onChange,
  onSubmit,
  busy,
  dictation,
}: {
  kind: "opening" | "closing";
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  dictation?: Dictation;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useDictationTarget(dictation, ref, value, onChange);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus({ preventScroll: true }), 380);
    return () => clearTimeout(t);
  }, []);
  const ok = value.trim().length > 0 && value.trim().length <= MAX_TEXT && !busy;
  const submit = () => ok && onSubmit();
  return (
    <div className="controls speechpad" onClick={stop} role="group" aria-label={kind === "opening" ? "Your opening statement" : "Your closing argument"}>
      <div className="pad-binding" aria-hidden />
      <div className="pad-head">
        <h2>{kind === "opening" ? "Your opening statement" : "Your closing argument"}</h2>
        <p>
          {kind === "opening"
            ? "Tell the jury what the evidence will show. You may preview any exhibit; every claim is fact-checked."
            : "The last word is yours. Argue only from testimony, admitted exhibits and the agreed facts."}
        </p>
      </div>
      <textarea
        ref={ref}
        className="pad-input"
        value={value}
        maxLength={MAX_TEXT}
        disabled={busy}
        placeholder={kind === "opening" ? "Members of the jury…" : "Members of the jury, you have heard…"}
        aria-label={kind === "opening" ? "Opening statement" : "Closing argument"}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="pad-foot">
        <Counter n={value.length} />
        {dictation?.notice ? (
          <DictationStatus d={dictation} />
        ) : (
          <span className="hint">
            <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd> to deliver · <kbd>Enter</kbd> new line
            {dictation?.available && (
              <>
                {" · hold "}
                <kbd>Alt</kbd> to dictate
              </>
            )}
          </span>
        )}
        {dictation && <MicButton d={dictation} disabled={busy} />}
        <button type="button" className="btn primary" disabled={!ok} onClick={submit}>
          {kind === "opening" ? "Deliver opening" : "Deliver closing"}
        </button>
      </div>
    </div>
  );
}

export function BeginCard({ onCaseFile, onBegin, busy, ready }: { onCaseFile: () => void; onBegin: () => void; busy: boolean; ready: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div className="controls begin-card" onClick={stop}>
      <span className="begin-kicker">The court is not yet in session</span>
      <div className="begin-actions">
        <button type="button" className="btn ghost" onClick={onCaseFile}>
          Reread the case file <span className="kbd-hint">C</span>
        </button>
        <button ref={ref} type="button" className="btn primary large" disabled={!ready || busy} onClick={onBegin}>
          {busy ? "All rise…" : "Proceed to trial"}
        </button>
      </div>
    </div>
  );
}
